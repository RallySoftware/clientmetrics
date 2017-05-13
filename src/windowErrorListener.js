/**
 * @class RallyMetrics.WindowErrorListener
 * A component that listens for unhandled errors and generates a message for them.
 *
 * This is used by client metrics to send client side errors to the beacon
 * @constructor
 * @param {RallyMetrics.ClientMetricsAggregator} aggregator
 * @param {Object} config Configuration object
 * @param {Number} [config.stackLimit] If defined, the stack trace for the error will be truncated
 *   to this limit
 */
class WindowErrorListener {
  constructor(aggregator, supportsOnError, config) {
    this.aggregator = aggregator;
    this._stackLimit = null;
    if (config && config.stackLimit) {
      this._stackLimit = parseInt(config.stackLimit, 10);
    }

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
      if (this._stackLimit) {
        miscData.stack = miscData.stack.split('\n').slice(0, this._stackLimit).join('\n');
      }
    }

    this.aggregator.recordError(errorInfo, miscData);
  }
}

export default WindowErrorListener;
