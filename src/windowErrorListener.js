/**
 * @class RallyMetrics.WindowErrorListener
 * A component that listens for unhandled errors and generates a message for them.
 *
 * This is used by client metrics to send client side errors to the beacon
 * @constructor
 * @param {RallyMetrics.ClientMetricsAggregator} aggregator
 */
class WindowErrorListener {
  constructor(aggregator) {
    this.aggregator = aggregator;

    this._originalWindowOnError = window.onerror;
    window.onerror = this._onWindowError.bind(this);
  }

  _onWindowError(msg, filename, lineno, colno, errorObject) {
    if (errorObject && errorObject.message) {
      this.aggregator.recordError(errorObject);
      return;
    }
    if (typeof this._originalWindowOnError === 'function') {
      this._originalWindowOnError.call(window, msg, filename, lineno);
    }

    const colIsNumber = !!colno;
    const message = msg || 'unknown message';
    const file = filename || '??';
    const lineNumber = lineno ? `:${lineno}` : '';
    const columnNumber = colIsNumber ? `:${colno}` : '';
    const errorInfo = `${message}, ${file}${lineNumber}${columnNumber}`;
    const miscData = {};

    if (colIsNumber) {
      miscData.columnNumber = colno;
    }

    if (errorObject && errorObject.stack) {
      miscData.stack = errorObject.stack;
    }

    this.aggregator.recordError(errorInfo, miscData);
  }
}

export default WindowErrorListener;
