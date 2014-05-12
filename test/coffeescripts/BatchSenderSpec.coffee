describe "RallyMetrics.BatchSender", ->

  fakeBeaconUrl = 'totallyfakeurl'

  helpers
    createSender: (config={}) ->
      new RallyMetrics.BatchSender _.defaults(config, beaconUrl: fakeBeaconUrl, minLength: 0)

    getData: (count) ->
      ({foo: i} for i in [0...count])

  beforeEach ->
    @spy document.body, 'appendChild'

  describe 'config options', ->
    describe 'keysToIgnore', ->
      it "should strip out all keys in keysToIgnore", ->
        aKeyToIgnore = "testKey"
        anotherKeyToIgnore = "theOtherKey"

        sender = @createSender keysToIgnore: [aKeyToIgnore, anotherKeyToIgnore]

        data = foo: "bar"
        data[aKeyToIgnore] = "should ignore this one"
        data[anotherKeyToIgnore] = "this one too"

        sender.send data

        img = document.body.appendChild.args[0][0]
        expect(img.src).to.have.string "foo.0=bar"
        expect(img.src).not.to.have.string "#{aKeyToIgnore}.0"
        expect(img.src).not.to.have.string "#{anotherKeyToIgnore}.0"

      it "should default emitWarnings to false", ->
        sender = @createSender()

        expect(sender.emitWarnings).to.be.false

  describe '#send', ->
    it "should append indices to the keys so they don't get clobbered", ->
      data = @getData(10)
      sender = @createSender(minLength: 10 * 8 + fakeBeaconUrl.length)

      sender.send datum for datum in data

      img = document.body.appendChild.args[0][0]
      for d, i in data
        expect(img.src).to.have.string "foo.#{i}=#{i}"

    it "should not send a batch if the url length is shorter than the configured min length", ->
      sender = @createSender
        minLength: 1000

      data = @getData(2)

      sender.send datum for datum in data
      expect(sender.getPendingEvents()).to.eql data
      expect(document.body.appendChild).not.to.have.been.called

    it "should not send a batch that contains one event that is too big", ->
      sender = @createSender
        minLength: 0
        maxLength: 100

      longValue = ''
      for i in [0..101]
        longValue += 'a'

      data = foo: longValue

      sender.send data

      expect(sender.getPendingEvents()).to.eql [data]
      expect(document.body.appendChild).not.to.have.been.called

    it "should send to the configured url", ->
      clientMetricsUrl = "http://localhost/testing"

      sender = @createSender(beaconUrl: clientMetricsUrl, minLength: 2 * 8 + clientMetricsUrl.length)
      data = @getData(2)

      sender.send datum for datum in data

      img = document.body.appendChild.args[0][0]
      expect(img.src).to.equal "#{clientMetricsUrl}?foo.0=0&foo.1=1"

    describe "emitWarnings", ->
      beforeEach ->
        @stub(console, 'warn')
        @bigEvent =
          bigdata: new Array(300).join('a')

      it "should log a warning if emitWarnings is enabled and the event is too big", ->
        sender = @createSender
          minLength: 0
          maxLength: 100
          emitWarnings: true

        sender.send(@bigEvent)
        expect(console.warn).to.have.been.called

      it "should not log a warning if emitWarnings is disabled and the event is too big", ->
        sender = @createSender
          minLength: 0
          maxLength: 100
          emitWarnings: false

        sender.send(@bigEvent)
        expect(console.warn).not.to.have.been.called

  describe '#flush', ->

    it "should send a batch even though the url length is shorter than the configured min length", ->
      clientMetricsUrl = "http://localhost/testing"

      sender = @createSender
        beaconUrl: clientMetricsUrl
        minLength: 1000

      data = @getData(2)

      sender.send datum for datum in data
      expect(sender.getPendingEvents()).to.eql data
      expect(document.body.appendChild).not.to.have.been.called

      sender.flush()

      expect(sender.getPendingEvents().length).to.equal 0
      expect(document.body.appendChild).to.have.been.calledOnce
      img = document.body.appendChild.args[0][0]
      expect(img.src).to.equal "#{clientMetricsUrl}?foo.0=0&foo.1=1"
