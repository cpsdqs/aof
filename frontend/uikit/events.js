/// Minimal reimplementation of the nodejs EventEmitter class
export default class EventEmitter {
    /// Event listeners.
    #listeners = {};

    /// Adds an event listener.
    on(event, callback) {
        if (!this.#listeners[event]) this.#listeners[event] = new Set();
        this.#listeners[event].add(callback);
    }
    /// Removes an event listener.
    removeListener(event, callback) {
        if (this.#listeners[event]) {
            this.#listeners[event].delete(callback);
        }
    }
    /// Emits an event.
    emit(event, ...args) {
        const errors = [];
        for (const listener of (this.#listeners[event] || [])) {
            try {
                listener(...args);
            } catch (err) {
                errors.push(err);
            }
        }
        if (errors.length) {
            if (errors.length === 1) throw errors[0];
            const error = new Error(`Error during event dispatch of "${event}": ${errors.map(e => e.toString()).join(', ')}`);
            error.errors = errors;
            throw error;
        }
    }
}
