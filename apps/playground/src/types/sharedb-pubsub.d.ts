declare module 'sharedb/lib/pubsub' {
  import type ShareDB = require('sharedb');

  export default class PubSub extends ShareDB.PubSub {}
}

declare module 'sharedb/lib/pubsub/memory' {
  import type ShareDB = require('sharedb');

  export default class MemoryPubSub extends ShareDB.PubSub {}
}
