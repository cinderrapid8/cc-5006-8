'use strict';

class ValidationError extends Error {
  constructor(errors) {
    super(`validation failed with ${errors.length} issue(s)`);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

function issue(code, message, loc = {}) {
  return { code, message, ...loc };
}

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(code, message, loc) {
    this.errors.push(issue(code, message, loc));
  }
  warn(code, message, loc) {
    this.warnings.push(issue(code, message, loc));
  }
  get ok() {
    return this.errors.length === 0;
  }
  throwIfFailed() {
    if (!this.ok) throw new ValidationError(this.errors);
  }
}

module.exports = { ValidationError, Report, issue };
