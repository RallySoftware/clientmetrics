# Rally Metrics

Rally Metrics is a Real User Monitoring library that allows your application to capture metrics and report them. The [Google Dapper whitepaper](https://research.google.com/pubs/pub36356.html) on distributed tracing is the foundation for this library.

## High-level concepts

### Distributed Traces

Distributed tracing is able to tie together events that happen across systems in order to understand the behavior and performance of complex applications.

### Spans

A _span_ is a measurement of work that is being done in the application. Its main attribute is its duration and each one has a unique id in UUID format.

This library introduces the concept of having different types of spans. Valid span types are:
* **load**: Loads are the most common type of span that represent something that happens over a duration of time.
* **dataRequest**: Data Requests also represent something that happens over time but specific to requests made to other services.
* **action**: An action is a point-in-time span. It doesn't have a duration (its start and end times are the same) and represents an action taken by the user or system.
* **error**: An error is also a point-in-time span that represents an unexpected error that has happened in the application. 

### Trace

A _trace_ is a collection of spans that represent all the work that happens as a result of one action. Everytime an _action_ is recorded, a new trace is started. A trace is simply a unique id that is associated with a group of spans. There is always one trace that is currently active (once the first action is recorded) and each span that is recorded is associated with the currently active trace.

### Parenting

A trace's spans are not a flat collection, but rather form a tree. Each span is able to reference another span as its _parent_. A parent span identifies the other unit of work that was responsible for initiating the span's unit of work.

For instance, this library gives you the ability to specify a _dataRequest_ span as the parent span when making a service request. The service can then start a new span representing the work done to service the request and associate it with the parent span. In this way, a trace can span across distributed systems (in this case the browser and the service).

## Installation
This module is distributed via [npm][npm] which is bundled with [node][node] and
should be installed as one of your project's `dependencies`:
```
npm install --save rally-clientmetrics
```
You can then use one of the module formats:

- `main`: `dist/rallymetrics.cjs.js` - exports itself as a CommonJS module
- `global`: `dist/rallymetrics.umd.js` and `dist/rallymetrics.umd.min.js` - exports
  itself as a [umd][umd] module which is consumable in several environments, the
  most notable as a global.
- `jsnext:main` and `module`: `dist/rallymetrics.es.js` - exports itself using the
  ES modules specification, you'll need to configure webpack to make use of this
  file do this using the [resolve.mainFields][mainFields] property.

The most common use-case is consuming this module via CommonJS:

```javascript
const ClientMetrics = require('rally-clientmetrics');
const Aggregator = new ClientMetrics.Aggregatator({...});
```

If you're transpiling (and/or using the `jsnext:main`):

```javascript
import ClientMetrics from 'rally-clientmetrics';
const Aggregator = new ClientMetrics.Aggregatator({...});
```
## Library API

After integrating this library into your web application, you can construct an instance of an Aggregator and use its methods to record application and user activity and send them to a beacon endpoint.

There are some deprecated methods on the Aggregator class. These are the ones you should be using:

### startSession(defaultParams: Object)

Use this method to group traces. You must call this method before any of the others. Whenever this method is called, any unfinished spans are dropped on the floor and the error counter resets. Any defaultParams specified will be added to each subsequent span. A common use case is to call this function every time the user navigates to another page. If you do this, you can supply a property on the defaultParams that identifies which page each subsequent span occurred on.

### recordAction(options: Object)

Call this method whenever the user or system performs an action (e.g. clicking a button, opening a dropdown, etc.). When this function is called, a new trace is started and any subsequent spans will be associated with the new trace.

### recordComponentReady(options: Object)

Component Ready spans are helpful for identifying when key components on the page are finished loading. These can be a key metric for how long actions take to complete. These events are basically load events and their start time is set to when the last action was started. They will have a `componentReady: true` property added to the event to identify them.

### recordError(e: Error, miscData: Object)

Use this method to record whenever an unexpected JS error is thrown. These errors can be captured with explicit try/catch blocks in the code or with a `window.onerror` handler such as the built-in `WindowErrorListener` class. When the WindowErrorListener class is instantiated, it will attach itself to `window.onerror` and call `recordError` whenever that event is triggered.

### startSpan(options: Object)

This is the method most commonly used to record units of work that happen in your application. When you call this method, you'll be returned an object that has all the event data and also an `end` function that can be called when the unit of work has finished. You'll specify the type of action (usually `load` or `dataRequest`) along with the other properties.

This can be used to record actions dispatched in a Redux application or all service calls (data requests) that go through a common module, among other things that make sense for your application.

If you are tracking service calls, then you'll want to make sure that you pass along the `trace id` and `span id` information with the request so the service can associate the spans it created with this parent span and trace. On the object that's returned from the `startSpan` call, you can get these values like so:
```js
const span = startSpan(options);
const traceId = span.data.tId;
const spanId = span.data.eId;
```
Then, you can add these values as request headers on the service request like so:
```js
  headers['X-Trace-Id'] = traceId;
  headers['X-ParentSpan-Id'] = spanId;
```
On the server, you can use these request headers whenever recording spans to associate them and be able to visualize a distributed trace.

## Transmitting data to the beacon

## Span/Event properties

Each span (or event) has the following properties, depending on which type of span it is. Additionally, any span can have additional properties set using the `miscData` property or when calling `startSession`.

### Action type span properties

* eType: 'action'
* cmpH: string (options.hierarchy)
* eDesc: string (options.description)
* eId: UUID (eventId)
* tId: UUID (traceId - same value as eId)
* cmpType: string (options.name)
* start: number (relative to session start time)
* stop: number (same value as start)
* tabId: UUID (created when Aggregator is constructed)
* bts: number (Browser timestamp of start time)

### Component Ready span properties

* eType: 'load'
* cmpH: string (options.hierarchy)
* eDesc: string (options.description)
* eId: UUID (eventId)
* tId: UUID (traceId)
* pId: UUID (parentSpanId - same value as tId)
* cmpType: string (options.name)
* start: number (relative to session start time)
* stop: number (relative to session start time)
* tabId: UUID (created when Aggregator is constructed)
* bts: number (Browser timestamp of start time)
* componentReady: true

### Error span properties

* eType: 'error'
* error: string (Error message)
* stack: string (stack trace of Error)
* eId: UUID (eventId)
* tId: UUID (traceId)
* start: number (relative to session start time)
* stop: number (same value as start)
* tabId: UUID (created when Aggregator is constructed)
* bts: number (Browser timestamp of start time)

### Load type span properties

* eType: 'load'
* cmpH: string (options.hierarchy)
* eDesc: string (options.description)
* eId: UUID (eventId)
* tId: UUID (traceId - same value as eId)
* cmpType: string (options.name)
* start: number (relative to session start time)
* stop: number (relative to session start time)
* tabId: UUID (created when Aggregator is constructed)
* bts: number (Browser timestamp of start time)

### Beacon requests

The library will periodically send spans to the configured beacon. You can set the beacon endpoint using the `beaconUrl` property when constructing the Aggregator.

Rally Metrics uses CORS to send its data to the configured beacon. All data is sent using the `POST` http method and `Content-type="application/json; charset=utf-8"`. The post body is a JSON-stringified object with the properties from each event. The properties for each event will be suffixed with the event index number. For example, if these events are being sent to the beacon:
```js
[
    {
        "eType": "action",
        "cmpH": "Site",
        "eDesc": "viewport creation",
        "eId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "tId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "cmpType": "Site",
        "start": "72",
        "stop": "72",
        "tabId": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
        "bts": "1494622096825"
    }, {
        "eType": "load",
        "cmpH": "UserActions",
        "eId": "7b15da1e-2a44-4fa1-892c-bd709e40d1d7",
        "cmpType": "UserActions",
        "tId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "pId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "start": "74",
        "eDesc": "userLoggedIn",
        "tabId": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
        "bts": "1494622096827",
        "stop": "86"
    }, {
        "eType": "load",
        "cmpH": "Dispatcher",
        "eId": "8d924973-a08c-4010-9227-4305fbfc3fc7",
        "cmpType": "Dispatcher",
        "tId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "pId": "7b15da1e-2a44-4fa1-892c-bd709e40d1d7",
        "start": "87",
        "eDesc": "dispatching USER_LOGGED_IN",
        "tabId": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
        "bts": "1494622096840",
        "stop": "87"
    }, {
        "eType": "load",
        "cmpH": "Dispatcher",
        "eId": "4d24c78a-2d80-4abd-94f9-ccca69735af0",
        "cmpType": "Dispatcher",
        "tId": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
        "pId": "67caf45e-c2cd-4eaa-8cf7-02c3ba1b2f99",
        "start": "159",
        "eDesc": "dispatching USER_STORIES_REQUESTED",
        "tabId": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
        "bts": "1494622096912",
        "stop": "160",
    }
]
```
Then the beacon would receive the following object, but JSON-stringified:
```js
{
    "eType.0": "action",
    "cmpH.0": "Site",
    "eDesc.0": "viewport creation",
    "eId.0": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "tId.0": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "cmpType.0": "Site",
    "start.0": "72",
    "stop.0": "72",
    "tabId.0": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
    "bts.0": "1494622096825",
    "eType.1": "load",
    "cmpH.1": "UserActions",
    "eId.1": "7b15da1e-2a44-4fa1-892c-bd709e40d1d7",
    "cmpType.1": "UserActions",
    "tId.1": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "pId.1": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "start.1": "74",
    "eDesc.1": "userLoggedIn",
    "tabId.1": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
    "bts.1": "1494622096827",
    "stop.1": "86",
    "eType.2": "load",
    "cmpH.2": "Dispatcher",
    "eId.2": "8d924973-a08c-4010-9227-4305fbfc3fc7",
    "cmpType.2": "Dispatcher",
    "tId.2": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "pId.2": "7b15da1e-2a44-4fa1-892c-bd709e40d1d7",
    "start.2": "87",
    "eDesc.2": "dispatching USER_LOGGED_IN",
    "tabId.2": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
    "bts.2": "1494622096840",
    "stop.2": "87",
    "eType.3": "load",
    "cmpH.3": "Dispatcher",
    "eId.3": "4d24c78a-2d80-4abd-94f9-ccca69735af0",
    "cmpType.3": "Dispatcher",
    "tId.3": "a82bff4c-d62d-4f0a-9ef1-a6032b3e97ce",
    "pId.3": "67caf45e-c2cd-4eaa-8cf7-02c3ba1b2f99",
    "start.3": "159",
    "eDesc.3": "dispatching USER_STORIES_REQUESTED",
    "tabId.3": "17e4c7a7-9459-4b0d-a522-8b5c4a64ab7f",
    "bts.3": "1494622096912",
    "stop.3": "160",
}
```

## Usage Guidelines

Try to keep these things in mind when using client metrics:
* **Spans are associated with the trace of the last action:** So it's important that an action has been called (typically based on a user action, such as a click) before span is started and ended. If not, the span will be tied to the previous action and will skew that action's total time.
* **Be Conscise:** Keep your client metrics as simple and to the point as possible to help with data aggregation. To keep your data shorter, there are just two things to be aware of:
    * use `miscData` sparingly.
    * Don't worry about data request URLs, the system is trimming them down automatically
    * Make your `description` strings unique and as short as possible. Generally speaking, the description string does not need to contain the name of the component. The span data contains the name of the component that is involved.
* **Be sure the client metric calls are accurate:** This sounds obvious, but in our experience, it can be difficult to truly know when something is done loading. The accuracy of the client metrics data is
reliant on the calls being made at the correct time.
* **Record all data requests:** This is easiest to do if all service reqeusts are made through a common module. This module can wrap the request with a `dataRequest` span and make sure the service is passed the trace ID and parent span ID.

## Contributing to RallyMetrics

See [Contributing](https://github.com/RallySoftware/clientmetrics/blob/master/CONTRIBUTING.md)

[npm]: https://www.npmjs.com/
[node]: https://nodejs.org
[mainFields]: https://webpack.js.org/configuration/resolve/#resolve-mainfields
