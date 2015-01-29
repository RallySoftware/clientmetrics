uuidFormat = /[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89aAbB][a-f0-9]{3}-[a-f0-9]{12}/

class Panel
  constructor: () ->
    @name = 'Panel'

  add: (config) ->
    child = new Panel()
    child.ownerCt = this
    child

describe "RallyMetrics.Aggregator", ->
  beforeEach ->
    @rallyRequestId = 123456

  helpers
    recordAction: (aggregator, cmp, description="an action") ->
      cmp ?= new Panel()
      aggregator.recordAction(component: cmp, description: description )
      return cmp

    beginLoad: (aggregator, cmp, description='an action', miscData={}) ->
      cmp ?= new Panel()
      aggregator.beginLoad(component: cmp, description: description, miscData: miscData )
      return cmp

    endLoad: (aggregator, cmp) ->
      cmp ?= new Panel()
      aggregator.endLoad(component: cmp)
      return cmp

    recordError: (aggregator, errorMessage='an error', miscData) ->
      aggregator.recordError(errorMessage, miscData)
      return errorMessage

    startSession: (aggregator, status="Navigation", defaultParams = {}) ->
      aggregator.startSession(status, defaultParams)
      return { status, defaultParams }

    createAggregator: (config={}) ->
      handler =
        getAppName: @stub().returns('testAppName')
        getComponentType: (cmp) ->
          if cmp.name then cmp.name else false

      aggregatorConfig = _.defaults config,
        sender: @createSender()
        handlers: [handler]

      new RallyMetrics.Aggregator(aggregatorConfig)

    createSender: ->
      @sentEvents = []

      send: (events) =>
        @sentEvents = @sentEvents.concat(events)
      getMaxLength: -> 2000
      flush: @stub()

    createAggregatorAndRecordAction: (config = {})->
      aggregator = @createAggregator(config)
      @recordAction(aggregator)
      aggregator

    findActionEvent: -> _.find(@sentEvents, eType: 'action')
    findLoadEvent: -> _.find(@sentEvents, eType: 'load')
    findDataEvent: -> _.find(@sentEvents, eType: 'dataRequest')
    findErrorEvent: -> _.find(@sentEvents, eType: 'error')
    findComponentReadyEvent: ->
      _.find @sentEvents, (e) ->
        e.eType == 'load' && e.componentReady

  describe 'batch sender', ->
    it 'should create a batch sender if one is not provided', ->
      aggregator = new RallyMetrics.Aggregator({})

      expect(aggregator.sender).to.be.an.instanceOf(RallyMetrics.CorsBatchSender)

  describe 'flushInterval', ->
    afterEach ->
      @aggregator?.destroy()

    it 'should flush on the specified interval', (done) ->
      @aggregator = @createAggregator
        flushInterval: 10

      start = new Date().getTime()

      once(
        condition: => @aggregator.sender.flush.callCount > 2
        description: 'waiting for flush to happen more than twice'
      ).done ->
        stop = new Date().getTime()
        expect(stop - start).to.be.greaterThan 20
        done()

  describe '#startSession', ->
    it "should start a new session", ->
      aggregator = @createAggregator()

      status = 'Navigation'
      defaultParams = foo: 'bar'

      @startSession aggregator, status, defaultParams

    it "should flush the sender", ->
      aggregator = @createAggregator()

      @startSession aggregator

      expect(aggregator.sender.flush).to.have.been.calledOnce

    it "should append defaultParams to events", ->
      aggregator = @createAggregator()

      hash = "/some/hash"
      defaultParams = hash: hash

      aggregator.startSession "Session 1", defaultParams
      @recordAction(aggregator)

      actionEvent = @findActionEvent()
      expect(actionEvent.hash).to.equal hash

    it "should allow developer to send a startTime", ->
      aggregator = @createAggregator()

      hash = "/some/hash"
      startingTime = new Date().getTime()-5000
      defaultParams = 
        hash: hash
        sessionStart: startingTime

      aggregator.startSession "Session 1", defaultParams
      
      expect(aggregator._sessionStartTime).to.be.greaterThan 0
      expect(aggregator._defaultParams.sessionStart).to.equal undefined #don't keep this as a default param

  describe '#sendAllRemainingEvents', ->
    it 'should flush the sender', ->
      aggregator = @createAggregator()

      aggregator.sendAllRemainingEvents()

      expect(aggregator.sender.flush).to.have.been.calledOnce

  describe 'data requests', ->
    beforeEach ->
      @xhrFake = sinon.useFakeXMLHttpRequest()

    afterEach ->
      @xhrFake.restore()

    it "should accept miscData", ->
      aggregator = @createAggregatorAndRecordAction()

      miscData = such: "wow"
      metricsData = aggregator.beginDataRequest this, "/foo", miscData
      aggregator.endDataRequest this, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.such).to.equal "wow"

    it "should trim the request url correctly", ->
      aggregator = @createAggregatorAndRecordAction()

      expectedUrl = "3.14/Foo.js"
      entireUrl = "http://localhost/testing/webservice/#{expectedUrl}?bar=baz&boo=buzz"

      metricsData = aggregator.beginDataRequest this, entireUrl
      aggregator.endDataRequest this, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.url).to.equal expectedUrl

    it "should have the component hierarchy for Ext4 nesting", ->
      aggregator = @createAggregatorAndRecordAction()
      parentPanel = new Panel()
      childPanel = parentPanel.add(xtype: "panel")

      metricsData = aggregator.beginDataRequest childPanel, "someUrl"
      aggregator.endDataRequest childPanel, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.cmpH).to.equal "Panel:Panel"

    it "should have the component hierarchy for Ext2 nesting", ->
      aggregator = @createAggregatorAndRecordAction()
      parentObj =
        name: 'Parent'

      childObj =
        name: 'Child'
        owner: parentObj

      metricsData = aggregator.beginDataRequest childObj, "someUrl"
      aggregator.endDataRequest childObj, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.cmpH).to.equal "Child:Parent"

    it "should have the component hierarchy for initialConfig nesting", ->
      aggregator = @createAggregatorAndRecordAction()
      parentObj =
        name: 'Parent'

      childObj =
        name: 'Child'
        initialConfig:
          owner: parentObj

      metricsData = aggregator.beginDataRequest childObj, "someUrl"
      aggregator.endDataRequest childObj, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.cmpH).to.equal "Child:Parent"

    it "should have the component hierarchy for clientMetricsParent property", ->
      aggregator = @createAggregatorAndRecordAction()
      parentObj =
        name: 'Parent'

      childObj =
        name: 'Child'
        clientMetricsParent: parentObj

      metricsData = aggregator.beginDataRequest childObj, "someUrl"
      aggregator.endDataRequest childObj, @xhrFake, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.cmpH).to.equal "Child:Parent"

    it "returns ID properties for AJAX headers", ->
      aggregator = @createAggregatorAndRecordAction()
      requester = this

      metricsData = aggregator.beginDataRequest requester, "someUrl"
      aggregator.endDataRequest requester, @xhrFake, metricsData.requestId

      actionEvent = @findActionEvent()
      dataEvent = @findDataEvent()

      expect(metricsData.xhrHeaders).to.eql 'X-Parent-Id': dataEvent.eId, 'X-Trace-Id': actionEvent.eId

    it "does not return ID properties for AJAX headers when request is not instrumented", ->
      aggregator = @createAggregatorAndRecordAction()

      metricsData = aggregator.beginDataRequest null, "someUrl"

      expect(metricsData).to.be.undefined

    it "appends the rallyRequestId onto dataRequest events", ->
      aggregator = @createAggregatorAndRecordAction()

      xhr = new XMLHttpRequest()
      xhr.open('GET', 'someUrl', true)
      xhr.send('data')
      xhr.setResponseHeaders
        RallyRequestID: @rallyRequestId
      xhr.setResponseBody 'textual healing'

      metricsData = aggregator.beginDataRequest this, "someUrl"
      aggregator.endDataRequest this, xhr, metricsData.requestId

      dataEvent = @findDataEvent()
      expect(dataEvent.rallyRequestId).to.equal @rallyRequestId

    describe "passing in traceId", ->
      it "should allow options parameter for begin/endDataRequest", ->
        aggregator = @createAggregatorAndRecordAction()
        requester = this

        metricsData = aggregator.beginDataRequest(
          requester: requester
          url: "someUrl"
          miscData: doge: 'wow'
        )

        aggregator.endDataRequest(
          requester: requester
          xhr: @xhrFake
          requestId: metricsData.requestId
        )

        dataEvent = @findDataEvent()
        expect(dataEvent.url).to.equal("someUrl")
        expect(dataEvent.tId).to.match(uuidFormat)
        expect(dataEvent.eId).to.match(uuidFormat)
        expect(dataEvent.pId).to.match(uuidFormat)
        expect(dataEvent.doge).to.equal("wow")

      it "should allow a traceId to be passed in", ->
        traceId = uuid.v4()
        aggregator = @createAggregator()
        requester = this

        metricsData = aggregator.beginDataRequest(
          requester: requester
          url: "someUrl"
          traceId: traceId
        )

        aggregator.endDataRequest(
          requester: requester
          xhr: @xhrFake
          requestId: metricsData.requestId
        )

        dataEvent = @findDataEvent()
        expect(dataEvent.tId).to.equal(traceId)

  describe 'client metric event properties', ->
    beforeEach ->
      @appName = "testAppName"

      parentPanel = new Panel()
      childPanel = parentPanel.add(xtype: "panel")

      aggregator = @createAggregator()

      @recordAction(aggregator, parentPanel)
      @beginLoad(aggregator, childPanel)
      @endLoad(aggregator, childPanel)

      @actionEvent = @sentEvents[0]
      @loadEvent = @sentEvents[1]
      @browserTabId = aggregator._browserTabId

    it "should generate uuids for the event id and trace id", ->
      expect(@loadEvent.tId).to.match(uuidFormat)
      expect(@loadEvent.eId).to.match(uuidFormat)
      expect(@loadEvent.pId).to.match(uuidFormat)
      expect(@loadEvent.tabId).to.match(uuidFormat)

    it "should have trace id and event id for the action event", ->
      expect(@actionEvent.tId).to.be.a('string')
      expect(@actionEvent.eId).to.equal @actionEvent.tId

    it "should not set the parent id for the action event", ->
      expect(@actionEvent.pId).to.be.undefined

    it "should put the browser tab id on the events", ->
      expect(@actionEvent.tabId).to.equal @browserTabId
      expect(@loadEvent.tabId).to.equal @browserTabId

    it "should put the browser timestamp on the events", ->
      expect(@loadEvent.bts).to.be.a('number')
      expect(@actionEvent.bts).to.be.a('number')

    it "should put the app name on the events", ->
      expect(@loadEvent.appName).to.equal @appName
      expect(@actionEvent.appName).to.equal @appName

    it "should parent the load event to the action event", ->
      expect(@loadEvent.pId).to.be.a('string')
      expect(@loadEvent.pId).to.equal @actionEvent.eId

    it "should have a common trace id for all the events", ->
      expect(@loadEvent.tId).to.be.a('string')
      expect(@actionEvent.tId).to.be.a('string')
      expect(@actionEvent.tId).to.equal @loadEvent.tId

    it "should have a component type for the load event", ->
      expect(@loadEvent.cmpType).to.be.a('string')

    it "should put the component hierarchy on the events", ->
      expect(@actionEvent.cmpH).to.equal "Panel"
      expect(@loadEvent.cmpH).to.equal "Panel:Panel"

    it "puts start time on all events", ->
      expect(@actionEvent.start).to.be.a('number')
      expect(@loadEvent.start).to.be.a('number')

    it "puts stop time on the load event", ->
      expect(@loadEvent.stop).to.be.a('number')

  describe 'finding traceIDs', ->
    it "should find the correct traceId", ->
      aggregator = @createAggregator()
      handler = aggregator.handlers[0]

      parentPanel = new Panel()
      childPanel = parentPanel.add(xtype: "panel")

      @recordAction(aggregator, parentPanel)
      @recordAction(aggregator, parentPanel)
      @beginLoad(aggregator, childPanel)
      @endLoad(aggregator, childPanel)

      secondActionEvent = @sentEvents[1]
      loadEvent = @sentEvents[2]

      expect(loadEvent.pId).to.equal secondActionEvent.eId

    it "should not parent to an event that has completed", ->
      aggregator = @createAggregator()
      handler = aggregator.handlers[0]
      parentPanel = new Panel()
      childPanel1 = parentPanel.add(xtype: "panel")
      childPanel2 = parentPanel.add(xtype: "panel")

      @recordAction(aggregator, parentPanel)

      @beginLoad(aggregator, parentPanel)
      @beginLoad(aggregator, childPanel1)
      @endLoad(aggregator, childPanel1)
      @endLoad(aggregator, parentPanel)

      @beginLoad(aggregator, childPanel2)
      @endLoad(aggregator, childPanel2)

      # action, childPanel1, parentPanel1, childPanel2
      actionEvent = @sentEvents[0]
      parentLoadEvent = @sentEvents[2]
      childPanel1LoadEvent = @sentEvents[1]
      childPanel2LoadEvent = @sentEvents[3]

      expect(parentLoadEvent.tId).to.equal actionEvent.eId
      expect(childPanel1LoadEvent.tId).to.equal actionEvent.eId
      expect(childPanel2LoadEvent.tId).to.equal actionEvent.eId

      # child 1 should parent to the parent panel because it happened while the parent was loading
      expect(childPanel1LoadEvent.pId).to.equal parentLoadEvent.eId

      # child 2 should not parent to the parent panel because it happened afer the parent was done
      expect(childPanel2LoadEvent.pId).to.equal actionEvent.eId

  describe 'miscData', ->
    it "should append miscData to an event and not overwrite known properties", ->
      aggregator = @createAggregatorAndRecordAction()

      miscData =
        eId: "this shouldnt clobeber the real eId"
        foo: "this should get through"

      cmp = @beginLoad(aggregator, null, "a load", miscData)
      @endLoad(aggregator, cmp)

      loadEvent = @findLoadEvent()

      expect(loadEvent.eId).to.be.a('string')
      expect(loadEvent.eId).not.to.equal miscData.eId
      expect(loadEvent.foo).to.equal miscData.foo

  describe "#recordAction", ->
    it "should return the traceId", ->
      aggregator = @createAggregator()
      traceId = aggregator.recordAction
        component: {}
        description: "an action"

      expect(traceId).to.match(uuidFormat)

  describe "#beginLoad", ->
    beforeEach ->
      @panel = new Panel()

    it "should allow a traceId to be passed in", ->
      traceId = uuid.v4()
      aggregator = @createAggregator()

      aggregator.beginLoad(
        component: @panel
        traceId: traceId
        description: "panel loading"
      )
      aggregator.endLoad(component: @panel)

      loadEvent = @findLoadEvent()
      expect(loadEvent.tId).to.equal(traceId)


  describe '#recordError', ->
    it "sends an error event", ->
      aggregator = @createAggregatorAndRecordAction()
      errorMessage = @recordError(aggregator)

      expect(@sentEvents.length).to.equal 2
      errorEvent = @findErrorEvent()
      expect(errorEvent.eType).to.equal "error"
      expect(errorEvent.error).to.equal errorMessage

    it "does not create an error event if the error limit has been reached", ->
      aggregator = @createAggregatorAndRecordAction(errorLimit: 3)

      for i in [0...5]
        errorMessage = @recordError(aggregator)

      # one action plus three errors
      expect(@sentEvents.length).to.equal 4

      for errorEvent in @sentEvents[1..-1]
        expect(errorEvent.eType).to.equal "error"
        expect(errorEvent.error).to.equal errorMessage

    it "resets the error count whenever a new session starts", ->
      aggregator = @createAggregator()
      aggregator._errorCount = 2
      aggregator.startSession "newsession"
      expect(aggregator._errorCount).to.equal 0

    it "truncates long error info", ->
      errorMessage = ""
      for i in [1..1000]
        errorMessage += "uh oh"

      expect(errorMessage.length).to.be.greaterThan 2000

      aggregator = @createAggregatorAndRecordAction()
      @recordError(aggregator, errorMessage)

      expect(@sentEvents.length).to.equal 2
      errorEvent = @findErrorEvent()
      expect(errorEvent.error.length).to.be.lessThan 2000

    it "should send miscData keys and values if provided", ->
      aggregator = @createAggregatorAndRecordAction()

      obj =
        key1: 'value1'
        key2: 2
      errorMessage = @recordError(aggregator, "error", obj)

      errorEvent = @findErrorEvent()
      expect(_.pick(errorEvent, _.keys obj)).to.deep.equal obj

    it "should allow an options object parameter", ->
      aggregator = @createAggregatorAndRecordAction()
      aggregator.recordError(
        errorInfo: "an error occured"
        miscData: doge: 'wow'
      )

      errorEvent = @findErrorEvent()
      expect(errorEvent.error).to.equal("an error occured")
      expect(errorEvent.doge).to.equal("wow")

    it "should allow a traceId to be passed in", ->
      traceId = uuid.v4()
      aggregator = @createAggregator()
      aggregator.recordError(
        errorInfo: "an error occured"
        traceId: traceId
      )

      errorEvent = @findErrorEvent()
      expect(errorEvent.tId).to.equal(traceId)


  describe "#recordComponentReady", ->
    beforeEach ->
      @aggregator = @createAggregator()
      @panel = new Panel()

    it "should not record a component ready if there is no session", ->
      @aggregator.recordComponentReady(component: @panel)
      expect(@sentEvents.length).to.equal 0

    it "should record component ready even if there is not a current trace", ->
      @startSession(@aggregator)
      @aggregator.recordComponentReady(component: @panel)
      expect(@sentEvents.length).to.equal 1
      componentReadyEvent = @findComponentReadyEvent()
      expect(componentReadyEvent.tId).to.be.undefined
      expect(componentReadyEvent.componentReady).to.equal true

    it "should record the traceId if one is present", ->
      @startSession(@aggregator)
      @recordAction(@aggregator, @panel)
      @aggregator.recordComponentReady(component: @panel)
      expect(@sentEvents.length).to.equal 2

      actionEvent = @findActionEvent()
      componentReadyEvent = @findComponentReadyEvent()

      expect(actionEvent.tId).to.equal actionEvent.eId
      expect(componentReadyEvent.tId).to.equal actionEvent.eId
      expect(componentReadyEvent.pId).to.equal actionEvent.eId
      expect(componentReadyEvent.componentReady).to.equal true

    it "should record a start time equal to the session start time", ->
      @startSession(@aggregator)

      @aggregator.recordComponentReady(component: @panel)

      expect(@sentEvents.length).to.equal 1
      componentReadyEvent = @findComponentReadyEvent()

      expect(componentReadyEvent.start).to.be.a('number')
      expect(componentReadyEvent.start).to.equal(@aggregator._sessionStartTime)
      expect(componentReadyEvent.stop).to.be.a('number')
      expect(componentReadyEvent.componentReady).to.equal true

    it "should record a component as ready only once per session", ->
      @startSession(@aggregator)

      @aggregator.recordComponentReady(component: @panel)
      @aggregator.recordComponentReady(component: @panel)

      expect(@sentEvents.length).to.equal 1
      componentReadyEvent = @findComponentReadyEvent()
      expect(componentReadyEvent.eType).to.equal "load"
      expect(componentReadyEvent.componentReady).to.equal true

    it "should ignore a second component's ready if it has the same hierarchy as the previous component", ->
      @startSession(@aggregator)

      @aggregator.recordComponentReady(component: @panel)
      @aggregator.recordComponentReady(component: new Panel())

      expect(@sentEvents.length).to.equal 1
      componentReadyEvent = @findComponentReadyEvent()
      expect(componentReadyEvent.eType).to.equal "load"
      expect(componentReadyEvent.componentReady).to.equal true

    it "should record a component as ready a second time if a new session started", ->
      @startSession(@aggregator)

      @aggregator.recordComponentReady(component: @panel)
      @aggregator.recordComponentReady(component: @panel)

      @startSession(@aggregator)
      @aggregator.recordComponentReady(component: @panel)

      expect(@sentEvents.length).to.equal 2
      expect(@sentEvents[0].eType).to.equal "load"
      expect(@sentEvents[1].eType).to.equal "load"
      expect(@sentEvents[0].componentReady).to.equal true
      expect(@sentEvents[1].componentReady).to.equal true

    it "should allow a traceId to be passed in", ->
      traceId = uuid.v4()
      @startSession(@aggregator)
      @aggregator.recordComponentReady(
        component: @panel
        traceId: traceId
      )

      componentReadyEvent = @findComponentReadyEvent()

      expect(componentReadyEvent.tId).to.equal traceId
      expect(componentReadyEvent.pId).to.equal traceId
      expect(componentReadyEvent.componentReady).to.equal true


  describe 'additional parameters', ->
    it "should append guiTestParams to events", ->
      aggregator = @createAggregator()
      aggregator._guiTestParams = foo: "bar"
      @recordAction(aggregator)

      actionEvent = @findActionEvent()
      expect(actionEvent.foo).to.equal "bar"

  describe "#_getRallyRequestId", ->
    it "should find the RallyRequestId on an object", ->
      aggregator = @createAggregator()

      response =
        getResponseHeader:
          RallyRequestID: "myrequestid"

      expect(aggregator._getRallyRequestId(response)).to.equal "myrequestid"

    it "should find the RallyRequestId from a function", ->
      aggregator = @createAggregator()

      response =
        getResponseHeader: @stub().returns("myrequestid")

      expect(aggregator._getRallyRequestId(response)).to.equal "myrequestid"
      expect(response.getResponseHeader).to.have.been.calledWith("RallyRequestID")

    it "should not find a RallyRequestId if there is no getResponseHeader", ->
      aggregator = @createAggregator()

      response = {}

      expect(aggregator._getRallyRequestId(response)).to.be.undefined

    it "should not find a RallyRequestId if there getResponseHeader is something else", ->
      aggregator = @createAggregator()

      response = getResponseHeader: 123

      expect(aggregator._getRallyRequestId(response)).to.be.undefined

    it "should find a RallyRequestID if there is a headers method", ->
      aggregator = @createAggregator()

      response =
        headers: @stub().returns("myrequestid")

      expect(aggregator._getRallyRequestId(response)).to.equal "myrequestid"
      expect(response.headers).to.have.been.calledWith("RallyRequestID")

    it "should find a RallyRequestId if its passed in as a string", ->
      aggregator = @createAggregator()
      expect(aggregator._getRallyRequestId("ImARequestId")).to.equal "ImARequestId"
      expect(aggregator._getRallyRequestId(123)).to.be.undefined

  describe 'whenLongerThan parameter', ->
    it "should not send the event if the duration is not longer than the 'whenLongerThan' parameter value", ->
      aggregator = @createAggregatorAndRecordAction()
      @sentEvents = []
      startTime = 50
      cmp = new Panel()

      aggregator.beginLoad
        component: cmp,
        description: "a load",
        startTime: startTime

      aggregator.endLoad
        component: cmp,
        stopTime: startTime + 1000
        whenLongerThan: 1000

      expect(@sentEvents.length).to.equal 0

    it "should send the event if the duration is longer than the 'whenLongerThan' parameter value", ->
      aggregator = @createAggregatorAndRecordAction()
      @sentEvents = []
      startTime = 50
      cmp = new Panel()

      aggregator.beginLoad
        component: cmp,
        description: "a load",
        startTime: startTime

      aggregator.endLoad
        component: cmp,
        stopTime: startTime + 1001
        whenLongerThan: 1000

      expect(@sentEvents.length).to.equal 1
