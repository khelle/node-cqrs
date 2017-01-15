'use strict';

const Observer = require('./Observer');
const { isClass, coWrap } = require('./utils');

const _eventStore = Symbol('eventStore');
const _aggregateFactory = Symbol('aggregateTypeOrFactory');
const _handles = Symbol('handles');

module.exports = class AggregateCommandHandler extends Observer {

	/**
	 * Creates an instance of AggregateCommandHandler.
	 *
	 * @param {{ eventStore: object, aggregateType: class, handles: string[] }}
	 */
	constructor({ eventStore, aggregateType, handles }) {
		if (!eventStore) throw new TypeError('eventStore argument required');
		if (!aggregateType) throw new TypeError('aggregateType argument required');
		super();

		coWrap(this);

		Object.defineProperties(this, {
			[_eventStore]: {
				value: eventStore
			},
			[_aggregateFactory]: {
				value: isClass(aggregateType) ?
					params => new aggregateType(params) : // eslint-disable-line new-cap
					aggregateType
			},
			[_handles]: {
				value: handles || aggregateType.handles
			}
		});
	}

	/**
	 * Subscribe to all command types handled by aggregateType
	 *
	 * @param {EventEmitter} commandBus
	 * @returns {Promise<any[]>} - whatever EventEmitter.on returns for each messageType
	 */
	subscribe(commandBus) {
		return super.subscribe(commandBus, this[_handles], this.execute);
	}

	/**
	 * Restore aggregate from event store events
	 *
	 * @param {string} id
	 * @returns {Aggregate}
	 */
	* _restoreAggregate(id) {
		if (!id) throw new TypeError('id argument required');

		const events = yield this[_eventStore].getAggregateEvents(id);
		const aggregate = this[_aggregateFactory]({ id, events });
		this.info(`aggregate ${aggregate.id} (v${aggregate.version}) restored from event store`);

		return aggregate;
	}

	/**
	 * Create new aggregate with new Id generated by event store
	 *
	 * @returns {Aggregate}
	 */
	* _createAggregate() {
		const id = yield this[_eventStore].getNewId();
		const aggregate = this[_aggregateFactory]({ id });
		this.info(`aggregate ${aggregate.id} created`);

		return aggregate;
	}

	/**
	 * Pass a command to corresponding aggregate
	 *
	 * @param {{type: string}} cmd - command to execute
	 * @return {Promise<object[]>} events
	 */
	* execute(cmd) {
		if (!cmd) throw new TypeError('cmd argument required');
		if (!cmd.type) throw new TypeError('cmd.type argument required');

		const aggregate = yield cmd.aggregateId ?
			this._restoreAggregate(cmd.aggregateId) :
			this._createAggregate();

		yield Promise.resolve(aggregate.handle(cmd));

		const events = aggregate.changes;
		this.info(`command '${cmd.type}' processed, ${events.length === 1 ? '1 event' : `${events.length} events`} produced`);
		if (!events || !events.length)
			return [];

		return this[_eventStore].commit(events, { sourceCommand: cmd });
	}
};
