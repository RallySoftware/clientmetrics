//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
 

  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

(function(root, factory) {
  if(typeof exports === 'object') {
    module.exports = factory(require('underscore'));
  }
  else if(typeof define === 'function' && define.amd) {
    define(['underscore'], factory);
  }
  else {
    root.RallyMetrics = factory(root._);
  }
}(this, function(_) {
  var require=function(name){return {"underscore":_}[name];};
  require=(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var _ = require('underscore');
var BatchSender = require('./corsBatchSender');
var uuid = (window.uuid);

// The default for max number of errors we will send per session.
// In ALM, a session is started for each page visit.
var DEFAULT_ERROR_LIMIT = 25;

// bookkeeping properties that are set on components being measured
var _currentEventId = '__clientMetricsCurrentEventId__';
var _metricsIdProperty = '__clientMetricsID__';

/**
 * An aggregator that listens to all client metric related messages that go out on
 * the message bus and creates a cohesive picture of what is happening, then pushes
 * this data out to an endpoint which collects the data for analysis
 *
 * ##Aggregator specific terminology##
 *
 * * **event:** A distinct, measurable thing that the page did or the user invoked. For example, clicking on a button,
 * a panel loading, or a grid resorting are all events
 * * **handler:** A helper object that helps the aggregator identify where events came from.
 * * **status:** What was the ultimate fate of an event? If a panel fully loads and becomes fully usable, the event associated
 * with the panel load will have the status of "Ready". If the user navigates away from the page before the panel
 * finishes loading, the associated event's conclusion will be "Navigation". Current conclusion values are:
 *     - Ready: the event concluded normally
 *     - Navigation: the user navigated away before the event could complete
 *     - Timeout: (Not yet implemented), indicates a load event took too long
 *
 *
 *  NOTE: Most properties are short acronyms:
 *  * bts -- browser time stamp
 *  * tabId -- the browser tab ID
 *  * tId -- trace ID
 *  * eId -- event ID
 *  * pId -- parent ID
 *  * eType -- event type (ie load, action or dataRequest)
 *  * eDesc -- event description
 *  * cmpType -- component type
 *  * cmpId -- component ID
 *  * uId -- user id
 *  * sId -- subscription id
 *
 * @constructor
 * @param {Object} config Configuration object
 * @param {Object[]} [config.ajaxProviders] Ajax providers that emit the following events:
 *   * beforerequest - When an Ajax request is about to be made
 *   * requestcomplete - When an Ajax request has finished
 * @param {Object} [config.sender = BatchSender] Which sender to use. By default,
 *   a BatchSender will be used.
 * @param {Number} [config.flushInterval] If defined, events will be sent at least that often.
 * @param {String} [config.beaconUrl = "https://trust.f4tech.com/beacon/"] URL where the beacon is located.
 */
var Aggregator = function(config) {
    _.extend(this, config);

    this._pendingEvents = [];
    this._browserTabId = this._getUniqueId();
    this._startingTime = new Date().getTime();
    this._sessionId = 1;
    this._loadedComponents = [];

    // keep track of how many errors we have reported on, so we
    // can stop after a while and not flood the beacon
    this._errorCount = 0;
    this.errorLimit = this.errorLimit || DEFAULT_ERROR_LIMIT;

    this.handlers = this.handlers || [];

    this.sender = this.sender || new BatchSender({
        keysToIgnore: [ 'cmp', 'component' ],
        beaconUrl: config.beaconUrl,
        disableSending: config.disableSending
    });

    if (_.isFunction(this.sender.getMaxLength)) {
        this.maxErrorLength = Math.floor(this.sender.getMaxLength() * 0.9);
    }

    if (_.isNumber(this.flushInterval)) {
        this._flushIntervalId = window.setInterval(_.bind(this.sendAllRemainingEvents, this), this.flushInterval);
    }
};

/**
 * @public
 */
Aggregator.prototype.destroy = function() {
    if (this._flushIntervalId) {
        window.clearInterval(this._flushIntervalId);
    }
};

/**
 * Handles the starting of a new "session"
 * Finishes and sends off pending events with a Navigation status
 * Resets current parent events queue, starting time, and current hash
 * Calls a new navigation user action
 * @param status the event's status for each of the pending events
 * @param defaultParams Default parameters that are sent with each request
 * @param defaultParams.sessionStart start time for this session - defaults
 *   to now, but can be set if actual start is before library is initialized
 * @public
 */
Aggregator.prototype.startSession = function(status, defaultParams) {
    if (arguments.length < 2) {
      defaultParams = status;
    }
    this._pendingEvents = [];
    if (defaultParams && defaultParams.sessionStart) {
        this._startingTime = defaultParams.sessionStart;
        delete defaultParams.sessionStart;
    }
    this._sessionStartTime = this.getRelativeTime();
    this.sendAllRemainingEvents();
    this._defaultParams = defaultParams;

    this._errorCount = 0;
    this._loadedComponents = [];
    this._sessionId++;
};

/**
 * Handles the action client metrics message. Starts and completes a client metric event
 */
Aggregator.prototype.recordAction = function(options) {
    var cmp = options.component;
    delete options.component;
    var traceId = this._getUniqueId();
    var startTime = this.getRelativeTime(options.startTime);

    var action = this._startEvent(_.defaults({
        eType: 'action',
        cmp: cmp,
        cmpH: options.hierarchy || this._getHierarchyString(cmp),
        eDesc: options.description,
        cmpId: this._getComponentId(cmp),
        eId: traceId,
        tId: traceId,
        status: 'Ready',
        cmpType: options.name || this.getComponentType(cmp),
        start: startTime,
        stop: startTime
    }, options.miscData));

    this._currentTraceId = traceId;
    this._finishEvent(action);

    return traceId;
};

Aggregator.prototype.recordError = function(errorInfo, miscData) {
    var options;
    if (_.isObject(errorInfo) && errorInfo.errorInfo) {
        options = errorInfo;
        errorInfo = options.errorInfo;
        miscData = options.miscData;
    }

    var traceId = this._currentTraceId;

    if (traceId && this._errorCount < this.errorLimit) {
        ++this._errorCount;

        var errorMsg = errorInfo || 'unknown error';
        if (this.maxErrorLength) {
            errorMsg = errorMsg.substring(0, this.maxErrorLength);
        }

        var startTime = this.getRelativeTime();

        var errorEvent = this._startEvent(_.defaults({
            eType: 'error',
            error: errorMsg,
            eId: this._getUniqueId(),
            tId: traceId,
            start: startTime,
            stop: startTime
        }, miscData));

        this._finishEvent(errorEvent);

        // dont want errors to get left behind in the batch, force it to be sent now
        this.sendAllRemainingEvents();
    }
};

Aggregator.prototype.recordComponentReady = function(options) {
    if (_.isUndefined(this._sessionStartTime)) {
        return;
    }

    var traceId = this._currentTraceId;
    var cmp = options.component,
        cmpHierarchy = options.hierarchy || this._getHierarchyString(cmp);

    var seenThisComponentAlready = this._loadedComponents.indexOf(cmpHierarchy) > -1;

    if (seenThisComponentAlready) {
        return;
    }

    this._loadedComponents.push(cmpHierarchy);

    var cmpReadyEvent = this._startEvent(_.defaults({
        eType: 'load',
        start: this._sessionStartTime,
        stop: this.getRelativeTime(options.stopTime),
        eId: this._getUniqueId(),
        tId: traceId,
        pId: traceId,
        cmpType: options.name || this.getComponentType(cmp),
        cmpH: cmpHierarchy,
        eDesc: 'component ready',
        componentReady: true
    }, options.miscData));

    this._finishEvent(cmpReadyEvent);
};

/**
 * Starts a span and returns an object with the data and a
 * function to call to end and record the span. Spans that are not
 * yet ended when a new action is recorded will be dropped.
 * @param {Object} options Information to add to the span
 * @param {Object} options.component The component recording the span
 * @param {String} options.description The description of the load
 * @param {String} [options.hierarchy] The component hierarchy
 * @param {String} [options.name] The name of the component. If not passed, will attempt to determine the name
 * @param {String} [options.type = 'load'] The type of span. One of 'load' or 'dataRequest'
 * @param {Number} [options.startTime = new Date().getTime()] The start time of the span
 * @param {Object} [options.miscData] Any other data that should be recorded with the span
 */
Aggregator.prototype.startSpan = function(options) {
    var aggregator = this;
    var cmp = options.component;
    var traceId = this._currentTraceId;

    if (!traceId) {
        return;
    }

    var startTime = this.getRelativeTime(options.startTime);

    var eventId = this._getUniqueId();

    var event = _.defaults({
        eType: options.type || 'load',
        cmp: cmp,
        cmpH: options.hierarchy || this._getHierarchyString(cmp),
        eId: eventId,
        cmpType: options.name || this.getComponentType(cmp),
        tId: traceId,
        pId: options.pId || traceId,
        start: startTime
    }, options.miscData);
    if (options.description) {
      event.eDesc = options.description;
    }
    return {
      data: this._startEvent(event),
      end: function(options) {
          if (aggregator._currentTraceId !== traceId) {
            return;
          }
          options = options || {};
          options.stop = aggregator.getRelativeTime(options.stopTime);

          if (aggregator._shouldRecordEvent(this.data, options)) {
              aggregator._finishEvent(this.data, _.extend({
                  status: 'Ready'
              }, _.omit(options, 'stopTime')));
          }
      }
    };
};

/**
 * Starts a span of type "load", tracked on the passed-in component.
 * Calling "endLoad" with the same component will record the span
 * @param {Object} options Information to add to the event
 * @param {Object} options.component The component recording the event
 * @param {Number} [options.startTime = new Date().getTime()] The start time of the event
 * @param {String} options.description The description of the load
 * @param {Object} [options.miscData] Any other data that should be recorded with the event
 */
Aggregator.prototype.beginLoad = function(options) {
    var cmp = options.component;
    var traceId = this._currentTraceId;

    if (!traceId) {
        return;
    }

    if (cmp[_currentEventId + 'load']) {
        // already an in flight load event, so going to bail on this one
        return;
    }

    var startTime = this.getRelativeTime(options.startTime);

    var eventId = this._getUniqueId();
    cmp[_currentEventId + 'load'] = eventId;

    var event = _.defaults({
        eType: 'load',
        cmp: cmp,
        cmpH: this._getHierarchyString(cmp),
        eDesc: options.description,
        cmpId: this._getComponentId(cmp),
        eId: eventId,
        cmpType: this.getComponentType(cmp),
        tId: traceId,
        pId: this._findParentId(cmp, traceId),
        start: startTime
    }, options.miscData);
    this._startEvent(event);
};

/**
 * Handles the endLoad client metrics message. Finishes an event
 * @param {Object} options Information to add to the event
 * @param {Object} options.component The component recording the event
 * @param {Number} [options.stopTime = new Date().getTime()] The stop time of the event
 * @param {Number} [options.whenLongerThan] If specified, the event will be dropped if it did not take longer than
 * this value. Specified in milliseconds.
 */
Aggregator.prototype.endLoad = function(options) {
    var cmp = options.component;

    var eventId = cmp[_currentEventId + 'load'];

    if (!eventId) {
        // load end found without a load begin, not much can be done with it
        return;
    }

    delete cmp[_currentEventId + 'load'];

    var event = this._findPendingEvent(eventId);

    if (!event) {
        // if we didn't find a pending event, then the load begin happened before the
        // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
        // just ignoring it.
        return;
    }

    options.stop = this.getRelativeTime(options.stopTime);

    if (this._shouldRecordEvent(event, options)) {
        this._finishEvent(event, _.extend({
            status: 'Ready'
        }, _.omit(options, 'stopTime')));
    }
};

/**
 * Handler for before Ajax requests go out. Starts an event for the request,
 *
 * returns an object containting requestId and xhrHeaders
 *  -- requestId should be fed back into endDataRequest to associate the two calls
 *  -- xhrHeaders contains headers that should be added to the AJAX data request
 *
 * returns undefined if the data request could not be instrumented
 */
Aggregator.prototype.beginDataRequest = function(requester, url, miscData) {
    var options, metricsData;
    if (arguments.length === 1) {
        options = arguments[0];
        requester = options.requester;
        url = options.url;
        miscData = options.miscData;
    }

    var traceId = this._currentTraceId;

    if (requester && traceId) {
        var eventId = this._getUniqueId();
        var parentId = this._findParentId(requester, traceId);
        var ajaxRequestId = this._getUniqueId();
        requester[_currentEventId + 'dataRequest' + ajaxRequestId] = eventId;

        this._startEvent(_.defaults({
            eType: 'dataRequest',
            cmp: requester,
            cmpH: this._getHierarchyString(requester),
            url: this._getUrl(url),
            cmpType: this.getComponentType(requester),
            cmpId: this._getComponentId(requester),
            eId: eventId,
            tId: traceId,
            pId: parentId
        }, miscData));

        // NOTE: this looks wrong, but it's not
        // This client side dataRequest event is going to be
        // the "parent" of the server side event that responds.
        // So in the request headers, sending the current event Id as
        // the parent Id.
        metricsData = {
            requestId: ajaxRequestId,
            xhrHeaders: {
                'X-Trace-Id': traceId,
                'X-Parent-Id': eventId
            }
        };
    }

    return metricsData;
};

/**
 * handler for after the Ajax request has finished. Finishes an event for the data request
 */
Aggregator.prototype.endDataRequest = function(requester, xhr, requestId) {
    var options;

    if (arguments.length === 1) {
        options = arguments[0];
        requester = options.requester;
        xhr = options.xhr;
        requestId = options.requestId;
    }

    if (requester) {
        var eventId = requester[_currentEventId + 'dataRequest' + requestId];

        var event = this._findPendingEvent(eventId);
        if (!event) {
            // if we didn't find a pending event, then the request started before the
            // aggregator was ready or a new session was started. Since this load is beyond the scope of the aggregator,
            // just ignoring it.
            return;
        }

        var newEventData = {
            status: 'Ready',
            stop: this.getRelativeTime()
        };
        var rallyRequestId = this._getRallyRequestId(xhr);

        if (rallyRequestId) {
            newEventData.rallyRequestId = rallyRequestId;
        }

        this._finishEvent(event, newEventData);
    }
};

/**
 * Causes the sender to purge all events it may still have in its queue.
 * Typically done when the user navigates somewhere
 */
Aggregator.prototype.sendAllRemainingEvents = function() {
    this.sender.flush();
};

Aggregator.prototype.getComponentType = function(cmp) {
    return this._getFromHandlers(cmp.singleton || cmp, 'getComponentType');
};

Aggregator.prototype.getDefaultParams = function() {
    return this._defaultParams;
};

Aggregator.prototype.getSessionStartTime = function() {
    return this._sessionStartTime;
};

/**
 * Add a handler
 * @param {Object} handler The new handler
 * @param {Number} index The index to insert the new handler in the handlers collection.
 * If not specified it will be added to the end.
 * @public
 */
Aggregator.prototype.addHandler = function(handler, index) {
    var insertIndex = arguments.length === 2 ? index : this.handlers.length;
    this.handlers.splice(insertIndex, 0, handler);
};

/**
 * Creates a version 4 UUID
 * @private
 */
Aggregator.prototype._getUniqueId = function() {
    return uuid.v4();
};

/**
 * Gets the current timestamp relative to the session starting time
 * @param {Number} [timestamp] Timestamp to be converted or falsy to be now
 * @private
 */
Aggregator.prototype.getRelativeTime = function(timestamp) {
    return (timestamp || new Date().getTime()) - this._startingTime;
};

/**
 * Converts timestamp to not be relative to the session starting time
 * @param {Number} timestamp Timestamp to be converted
 * @private
 */
Aggregator.prototype.getUnrelativeTime = function(timestamp) {
    return timestamp + this._startingTime;
};

/**
 * Finishes an event object by completing necessary event properties
 * Adds this event object to the finished event queue
 * Sends finished events before clearing the finished events queue
 * @param existingEvent the event object that has started
 * @param newEventData an object with event properties to append if
 * it doesn't already exist on the event
 * @private
 */
Aggregator.prototype._finishEvent = function(existingEvent, newEventData) {
    var event = _.defaults(
        newEventData || {},
        existingEvent,
        this._defaultParams,
        this._guiTestParams
    );

    this._pendingEvents = _.without(this._pendingEvents, existingEvent);

    this.sender.send(event);
};

/**
 * Starts an event object by completing necessary event properties
 * Adds this new event object to the pending and current parent event queue
 * @param event the event object with event properties
 * @private
 */
Aggregator.prototype._startEvent = function(event) {
    event.tabId = this._browserTabId;

    if (!_.isNumber(event.start)) {
        event.start = this.getRelativeTime();
    }
    event.bts = this.getUnrelativeTime(event.start);

    if (event.cmp) {
        var appName = this._getFromHandlers(event.cmp, 'getAppName');

        if (appName) {
            event.appName = appName;
        }
    }

    this._pendingEvents.push(event);

    return event;
};

/**
 * Determines which handler (Ext4/Legacy Dashboard) to use for the requested method
 * @param cmp the component parameter used for the handler's method
 * @param methodName the method being requested
 * @private
 */
Aggregator.prototype._getFromHandlers = function(cmp, methodName) {
    var result = null;

    _.each(this.handlers, function(handler) {
        result = handler[methodName](cmp);
        return !result;
    });

    return result;
};

/**
 * Finds the parent's event ID
 * @param sourceCmp the component to get the parent's event ID for
 * @private
 */
Aggregator.prototype._findParentId = function(sourceCmp, traceId) {
    var hierarchy = this._getHierarchy(sourceCmp);
    var eventId = traceId;

    _.each(hierarchy, function(cmp) {
        var parentEvent = _.findLast(this._pendingEvents, function(event) {
            return event.eType !== 'dataRequest' && (event.cmp === cmp || event.cmp === sourceCmp) && event.tId === traceId;
        });
        if (parentEvent) {
            eventId = parentEvent.eId;
            return false;
        }
    }, this);

    return eventId;
};

/**
 * Sets the metrics Id property for the component with a generated uuid
 * @param cmp the component to get an ID for
 * @private
 */
Aggregator.prototype._getComponentId = function(cmp) {
    if (!cmp[_metricsIdProperty]) {
        cmp[_metricsIdProperty] = this._getUniqueId();
    }

    return cmp[_metricsIdProperty];
};

Aggregator.prototype._getHierarchy = function(cmp) {
    var cmpType = this.getComponentType(cmp);
    var hierarchy = [];

    while (cmpType) {
        hierarchy.push(cmp);
        cmp = cmp.clientMetricsParent || cmp.ownerCt || cmp.owner || (cmp.initialConfig && cmp.initialConfig.owner);
        cmpType = cmp && this.getComponentType(cmp);
    }

    return hierarchy;
};

Aggregator.prototype._getHierarchyString = function(cmp) {
    var hierarchy = this._getHierarchy(cmp);

    if (hierarchy.length === 0) {
        return 'none';
    }

    return _.map(hierarchy, function(c) {
      return this.getComponentType(c);
    }, this).join(':');
};

/**
 * Massages the AJAX url into a smaller form. Strips away the host and query
 * parameters.
 *
 * Example: http://server/slm/webservice/1.27/Defect.js?foo=bar&baz=buzz
 * becomes 1.27/Defect.js
 * @param url The url to clean up
 * @private
 */
Aggregator.prototype._getUrl = function(url) {
    if (!url) {
        return "unknown";
    }

    var webserviceSlug = 'webservice/';
    var webserviceIndex = url.indexOf(webserviceSlug);
    var questionIndex;

    if (webserviceIndex > -1) {
        questionIndex = url.indexOf('?', webserviceIndex);

        if (questionIndex < 0) {
            questionIndex = url.length;
        }

        var skip = webserviceSlug.length;
        return url.substring(webserviceIndex + skip, questionIndex);
    } else {
        questionIndex = url.indexOf('?');

        if (questionIndex < 0) {
            return url;
        }

        return url.substring(0, questionIndex);
    }
};

/**
 * Finds the RallyRequestId, if any, in the response sent back from the server
 * @param response the response that came back from an Ajax request
 * @private
 */
Aggregator.prototype._getRallyRequestId = function(response) {
    var headerName = 'RallyRequestID';

    if (response) {
        if (_.isString(response)) {
            return response;

        } else if (_.isObject(response.responseHeaders)) {
            return response.responseHeaders.RallyRequestID;

        } else if (_.isFunction(response.getResponseHeader)) {
            return response.getResponseHeader(headerName);

        } else if (_.isObject(response.getResponseHeader)) {
            return response.getResponseHeader[headerName];

        } else if (_.isFunction(response.headers)) {
            // support for Angular, which does not expose a standard XHR object
            return response.headers(headerName);
        }
    }
};

/**
 * Finds an event withing the pending events queue if one exists
 * @param eventId the event's ID used to find a match within the pending events
 * @private
 */
Aggregator.prototype._findPendingEvent = function(eventId) {
    return _.find(this._pendingEvents, {eId: eventId});
};

Aggregator.prototype._shouldRecordEvent = function(existingEvent, options) {
    if (options.whenLongerThan && (options.stop - existingEvent.start) <= options.whenLongerThan) {
        this._pendingEvents = _.without(this._pendingEvents, existingEvent);
        return false;
    }

    return true;
};

module.exports = Aggregator;

},{"./corsBatchSender":2}],2:[function(require,module,exports){

var _ = require('underscore');
var Util = require('./util');

// the min and max number of events to put into one batch. Since we are now
// using POSTs, we have a lot more room.
var MIN_NUMBER_OF_EVENTS = 25;
var MAX_NUMBER_OF_EVENTS = 100;

/**
 * A helper object for {@link Aggregator} whose
 * job is to send the generated event objects in an efficient manner.
 *
 * It does this by batching up the requests and sends as many as it can fit into one GET
 * request.
 * @constructor
 * @param {Object} config Configuration object
 * @param {String[]} [config.keysToIgnore = new Array()] Which properties on events should not be sent
 * @param {Number} [config.minNumberOfEvents = 25] The minimum number of events for one batch
 * @param {Number} [config.maxNumberOfEvents = 100] The maximum number of events for one batch
 * @param {String} [config.beaconUrl = "https://trust.f4tech.com/beacon/"] URL where the beacon is located.
 */
var CorsBatchSender = function(config) {
    _.defaults(this, config, {
        _disabled: false,
        keysToIgnore: [],
        minNumberOfEvents: MIN_NUMBER_OF_EVENTS,
        maxNumberOfEvents: MAX_NUMBER_OF_EVENTS,
        beaconUrl: "https://trust.f4tech.com/beacon/"
    });
    if (config.disableSending) {
        this._disableClientMetrics();
    }
    this._eventQueue = [];
};

CorsBatchSender.prototype.send = function(event) {
    this._eventQueue.push(this._cleanEvent(event));
    this._sendBatches();
};

CorsBatchSender.prototype.flush = function() {
    this._sendBatches({ flush: true });
};

CorsBatchSender.prototype.getPendingEvents = function() {
    return this._eventQueue;
};

CorsBatchSender.prototype.getMaxLength = function() {
    return this.maxLength;
};

CorsBatchSender.prototype._sendBatches = function(options) {
    var nextBatch;
    while ((nextBatch = this._getNextBatch(options))) {
        this._sendBatch(nextBatch);
    }
};

CorsBatchSender.prototype._cleanEvent = function(event) {
    return _.omit(event, this.keysToIgnore);
};

CorsBatchSender.prototype._getNextBatch = function(options) {
    var toBeSent = _.take(this._eventQueue, this.maxNumberOfEvents);

    if (toBeSent.length && (toBeSent.length >= this.minNumberOfEvents || (options && options.flush))) {
        return toBeSent;
    }
};

/**
 * Appends indices to the keys of the event. This is to avoid the keys being clobbered
 * in the GET request. Even though we are using POST now, these are still needed because
 * the beacon is using the same logic for POST and GET. It's maintaining GET for
 * backwards compatibility with old App SDKs
 *
 * @private
 */
CorsBatchSender.prototype._appendIndexToKeys = function(event, index) {
    return _.transform(event, function(result, value, key) {
        result[key + '.' + index] = value;
    });
};

/**
 * Causes a batch to get sent out to the configured endpoint
 *
 * @private
 */
CorsBatchSender.prototype._sendBatch = function(batch) {
    if (!this._disabled) {
        this._makePOST(batch);
    }
    this._eventQueue = _.difference(this._eventQueue, batch);
};

CorsBatchSender.prototype._getUrl = function() {
    return this.beaconUrl;
};

CorsBatchSender.prototype._disableClientMetrics = function() {
    this._disabled = true;
};

CorsBatchSender.prototype.isDisabled = function() {
    return this._disabled;
};

/**
 * Before CORS, the beacon GET requests meant all data was a string.
 * We are simulating that with this method, properly handling non-string
 * data on the backend is a decent amount of work. Hoping this method is
 * temporary.
 */
CorsBatchSender.prototype._allValuesAsStrings = function(event) {
    return _.forIn(event, function(value, key, object) {
        if (!_.isString(value)) {
            object[key] = "" + value;
        }
    });
};

CorsBatchSender.prototype._makePOST = function(events) {
    // from an array of individual events to an object of events with keys on them
    var data = _.reduce(events, function(data, event, index) {
        event = this._allValuesAsStrings(event);
        return _.extend(data, this._appendIndexToKeys(event, index));
    }, {}, this);

    try {
        var xhr = Util.createCorsXhr('POST', this.beaconUrl);
        if (xhr) {
            xhr.onerror = _.bind(this._disableClientMetrics, this);
            setTimeout(function() {
                xhr.send(JSON.stringify(data));
            }, 0);
        } else {
            this._disableClientMetrics();
        }
    } catch(e) {
        this._disableClientMetrics();
    }
};

module.exports = CorsBatchSender;

},{"./util":5}],"RallyMetrics":[function(require,module,exports){
module.exports=require('sOmqIC');
},{}],"sOmqIC":[function(require,module,exports){
module.exports = {
	"Aggregator": require ("./aggregator")
	,"CorsBatchSender": require ("./corsBatchSender")
	,"Util": require ("./util")
	,"WindowErrorListener": require ("./windowErrorListener")
}
;
},{"./aggregator":1,"./corsBatchSender":2,"./util":5,"./windowErrorListener":6}],5:[function(require,module,exports){
(function(){
    var _ = require('underscore');

    var Util = {
        addEventHandler: function(target, eventName, callback, bubble) {
            if (target.addEventListener) {
                target.addEventListener(eventName, callback, bubble);
            } else if (target.attachEvent) {
                target.attachEvent('on' + eventName, callback);
            }
        },

        removeEventHandler: function(target, eventName, callback) {
            if (target.removeEventListener) {
                target.removeEventListener(eventName, callback);
            } else if (target.detachEvent) {
                target.detachEvent('on' + eventName, callback);
            }
        },

        removeFromDom: function(element) {
            if (_.isFunction(element.remove)) {
                element.remove();
            } else if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        },

        createCorsXhr: function(method, url){
            var xhr = new XMLHttpRequest();
            if ("withCredentials" in xhr) {
                xhr.open(method, url, true);
                xhr.setRequestHeader('Content-type','application/json; charset=utf-8');
            } else if (typeof XDomainRequest !== "undefined") {
                xhr = new XDomainRequest();
                xhr.onload = function() {};
                xhr.onprogress = function() {};
                xhr.ontimeout = function() {};

                xhr.open(method, url);
            } else {
                xhr = null;
            }

            return xhr;
        }
    };

    module.exports = Util;
})();

},{}],6:[function(require,module,exports){
(function() {
    var _ = require('underscore');
    var Util = require('./util');

    var browserSupportsOnError = true;
    var errorTpl = _.template("<%= message %>, <%= filename %>:<%= lineNumber %>");
    var unhandledErrorTpl = _.template("onerror::<%= message %>, <%= filename %>:<%= lineNumber %>");

    /**
     * @class RallyMetrics.WindowErrorListener
     * A component that listens for unhandled errors and generates a message for them.
     *
     * This is used by client metrics to send client side errors to the beacon
     * @constructor
     * @param {RallyMetrics.ClientMetricsAggregator} aggregator
     * @param {Boolean} [supportsOnError=true] Does the browser support window.onerror?
     * @param {Object} config Configuration object
     * @param {Number} [config.stackLimit] If defined, the stack trace for the error will be truncated to this limit
     */
    var ErrorListener = function(aggregator, supportsOnError, config) {
        var useOnError = _.isBoolean(supportsOnError) ? supportsOnError : browserSupportsOnError;
        this.aggregator = aggregator;
        this._stackLimit = null;
        if (config && config.stackLimit) {
            this._stackLimit = parseInt(config.stackLimit, 10);
        }

        if (useOnError) {
            this._originalWindowOnError = window.onerror;
            window.onerror = _.bind(this._windowOnError, this);
        } else {
            Util.addEventHandler(window, 'error', _.bind(this._onUnhandledError, this), false);
        }
    };

    _.extend(ErrorListener.prototype, {

        _windowOnError: function(message, filename, lineNum, columnNum, errorObject) {
            if (_.isFunction(this._originalWindowOnError)) {
                this._originalWindowOnError.call(window, message, filename, lineNum);
            }

            var errorInfo = errorTpl({
                message: message || 'unknown message',
                filename: filename || '??',
                lineNumber: _.isNumber(lineNum) ? lineNum : '??'
            });

            var miscData = {};
            if (columnNum) {
                miscData.columnNumber = columnNum;
            }

            if (errorObject && errorObject.stack) {
                miscData.stack = errorObject.stack;
                if (this._stackLimit) {
                    miscData.stack = _.take(miscData.stack.split('\n'), this._stackLimit).join('\n');
                }
            }

            this.aggregator.recordError(errorInfo, miscData);
        },

        _onUnhandledError: function(evt) {
            var errorInfo;
            if (evt.browserEvent) {
                errorInfo = unhandledErrorTpl({
                    message: evt.browserEvent.message || 'unknown message',
                    filename: evt.browserEvent.filename || '??',
                    lineNumber: evt.browserEvent.lineno || '??'
                });
            } else {
                errorInfo = 'onerror::' + (evt.message || 'unknown error');
            }
            this.aggregator.recordError(errorInfo);
        }
    });

    module.exports = ErrorListener;
})();


},{"./util":5}]},{},["sOmqIC"])
  return require('RallyMetrics');
}));