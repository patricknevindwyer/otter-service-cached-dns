var express = require('express');
var router = express.Router();
var request = require('request');
var dns = require('dns');
var async = require("async");
var _ = require("underscore");

var RESOLVE_INTERVAL = 1000;
var WEBHOOK_REMOTE = "http://localhost:8000/webhook/cacheddns/";

/*
    This module conforms to a standard Webhook based round trip.
    
    1. POST /resolve  (JSON body) - data to resolve
    2. enqueue data for resolve
    3. interval check for resolve data in queue
    4. Resolve top item from queue
    5. Store resolved data
    6. Tickle remote webhook for "completed" state
      6a. GET <remote>:/<webhook>/<item_id>/resolved
    7. GET /resolved/<item_id>
    8. DELETE /resolved/<item_id>

*/

var RESOLVE_QUEUE = [];
var RESOLVED_DATA = {};

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
            
            RESOLVED_DATA[queuedItem.uuid] = records;
            
            tickleWebhook(queuedItem.uuid + "/ready", next);
            
        }
    )
        

}

function tickleWebhook(path, next) {
    request(WEBHOOK_REMOTE + path, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            next();
        }
        else {
            console.log("Error calling remote webook at [%s]\n\tcode: %d\n\terror: %s", WEBHOOK_REMOTE + path, response.statusCode, error);
            next();
        }
    })   
}

/*
    Generic queue check and drain that kicks off at most
    every RESOLVE_INTERVAL milliseconds. 
*/
function checkResolveQueue() {
    
    if (RESOLVE_QUEUE.length > 0) {
        var resolveItem = RESOLVE_QUEUE.shift();
        resolveData(resolveItem, 
            function () {
                setTimeout(checkResolveQueue, RESOLVE_INTERVAL);
            }
        );
    }
    else {
        setTimeout(checkResolveQueue, RESOLVE_INTERVAL);
    }
}
checkResolveQueue();

router.post("/resolve", function (req, res, next) {
    
    RESOLVE_QUEUE.push(req.body);
    res.json({error: false, msg: "ok"});
    
});

router.get(/^\/resolved\/([a-zA-Z0-9\-]+)\/?$/, function (req, res, next) {
    var resolveUuid = req.params[0];
    console.log("Results being retrieved for [%s]", resolveUuid);
    if (RESOLVED_DATA[resolveUuid] !== undefined) {
        res.json({error: false, result: RESOLVED_DATA[resolveUuid]});
    }
    else {
        console.log("Invalid UUID specified");
        res.json({error: true, msg: "No such resolved UUID"});
    }
});

router.delete(/^\/resolved\/([a-zA-Z0-9\-]+)\/?$/, function (req, res, next) {
    var resolveUuid = req.params[0];
    console.log("Deleting results for [%s]", resolveUuid);
    delete RESOLVED_DATA[resolveUuid];
    res.json({error: false, msg: "ok"});
});




module.exports = router;
