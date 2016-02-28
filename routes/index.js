var express = require('express');
var router = express.Router();
var request = require('request');
var dns = require('dns');
var async = require("async");
var _ = require("underscore");

var dispatch = require("dispatch-client");
var webhookService = require("webhook-service");

var WEBHOOK_REMOTE = "http://localhost:8000/webhook/cacheddns/";

// Register ourselves with the dispatch server to find and share URIs for services
var dispatcher = new dispatch.Client("http://localhost:20000");
dispatcher.register("service-cacheddns", ["dns"]);

// Setup the new webhook service responder
var webhookedService = new webhookService.Service(WEBHOOK_REMOTE);
webhookedService.useRouter(router);
webhookedService.callResolver(resolveData);
webhookedService.start();

function resolveData(queuedItem, next) {
    console.log("Resolving [%s]\n\t%s", queuedItem.uuid, queuedItem.fqdn);
    
    var hostname = queuedItem.fqdn;
    
    dns.lookup(
        // hostname to lookup
        hostname,
        
        // options (lookup both v4 and v6 addresses)
        {
            all: true,
            hints: dns.V4MAPPED    
        },
        
        // lookup callback
        function (err, addresses) {
            console.log("Address resolution complete");
            // turn our addresses into real records
            var records = {};
            _.each(addresses, function (address) {
                if (address.family === 4) {
                    if (!_.contains(records, "A")) {
                        records["A"] = [];
                    }
                    records["A"].push(address.address);
                }
                else if (address.family === 6) {
                    if (!_.contains(records, "AAAA")) {
                        records["AAAA"] = [];
                    }
                    records["AAAA"].push(address.address);
                }
            });
            
            webhookedService.saveResolved(queuedItem.uuid, records);
            webhookedService.tickleWebhook(queuedItem.uuid, next);
            
        }
    )
}

module.exports = router;
