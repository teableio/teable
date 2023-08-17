# TeableEventEmitterModule

The TeableEventEmitterModule is a core component of the Teable project, specializing in handling event management related to various operations such as creation, editing, and deletion. It cleverly uses `op` operations to generate events and emits these events in a timely manner through the EventEmitter2 class.

## What is the EventEmitterService?

The EventEmitterService is a powerful service that implements the conversion of operations into corresponding events, grouping of these events, converting them into instances of specific event classes, and emitting them using an event emitter. It is the core of the TeableEventEmitterModule, providing event-driven capabilities for the Teable project.

## Methods and Usage

### ops2Event

`ops2Event` is the main method of EventEmitterService, accepting an `ops` operation array as input and generating corresponding events. This method groups these events according to `docType` and `eventType`. Then, `ops2Event` converts these events into instances of corresponding event classes and emits them using the `EventEmitter2` class.

This method is mainly used to convert operations into events and distribute these events. Executing the `ops2Event` method will trigger the corresponding events.

### Event Listening

If you need to listen to a specific event, you should use the `@OnEvent` decorator. The `@OnEvent` decorator can be applied to methods, making them handlers for the specified event.

For example, if you want to listen to a record creation event, you can use it like this:

```typescript
@OnEvent(EventEnums.RecordCreated)
handleRecordCreated(event: RecordCreatedEvent) {
  // your code here
}
```

In this example, when the `RecordCreated` event occurs, the `handleRecordCreated` method will be called, and the `event` parameter will be the event object that triggered the event.

## Supported Events

The TeableEventEmitterModule supports the following events:

- `RecordCreated`: Triggered when a new record is created.

- `RecordUpdated`: Triggered when an existing record is updated.

- `ViewCreated`: Triggered when a new view is created.

- `ViewUpdated`: Triggered when an existing view is updated.

- `FieldCreated`: Triggered when a new field is created.

- `FieldUpdated`: Triggered when an existing field is updated.

In all cases, your defined listener methods will receive the event object as a parameter, which you can use to perform any necessary operations. This provides you with powerful flexibility and control, allowing you to customize according to the specific needs of your project.
