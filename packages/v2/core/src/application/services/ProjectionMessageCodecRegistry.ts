import { err, ok, type Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { domainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type {
  EncodedProjectionMessage,
  IProjectionMessageCodec,
  IProjectionMessageCodecRegistry,
  ProjectionMessageDecoderIdentity,
  ProjectionMessageJson,
} from '../../ports/ProjectionMessage';
import { EventTypeIndex } from './EventTypeIndex';

type RegisteredCodec = IProjectionMessageCodec<IDomainEvent, ProjectionMessageJson>;

export class ProjectionMessageCodecRegistry implements IProjectionMessageCodecRegistry {
  private constructor(
    private readonly producerCodecs: EventTypeIndex<RegisteredCodec>,
    private readonly decoderCodecs: ReadonlyMap<string, RegisteredCodec>
  ) {}

  static create(
    codecs: ReadonlyArray<IProjectionMessageCodec>
  ): Result<ProjectionMessageCodecRegistry, DomainError> {
    // Producers are keyed by the event class object: bundlers rename classes,
    // so two unrelated events can share a `name` and a name-keyed map would
    // either reject a valid registry or route one event to the wrong codec.
    const producerCodecs = new EventTypeIndex<RegisteredCodec>();
    const decoderCodecs = new Map<string, RegisteredCodec>();
    for (const codec of codecs) {
      const registered = codec as RegisteredCodec;
      if (!registered.messageName.trim()) {
        return err(
          domainError.invariant({
            code: 'projection_message.codec_not_registered',
            message: 'Codec message name is empty',
          })
        );
      }
      if (!Number.isSafeInteger(registered.schemaVersion) || registered.schemaVersion < 1) {
        return err(
          domainError.invariant({
            code: 'projection_message.schema_version_unsupported',
            message: `Invalid schema version ${registered.schemaVersion}`,
          })
        );
      }
      if (producerCodecs.has(registered.eventType)) {
        return err(
          domainError.invariant({
            code: 'projection_message.codec_not_registered',
            message: `Duplicate producer codec for ${registered.eventType.name}`,
          })
        );
      }
      const decoderKey = `${registered.messageName}\0${registered.schemaVersion}`;
      if (decoderCodecs.has(decoderKey)) {
        return err(
          domainError.invariant({
            code: 'projection_message.codec_not_registered',
            message: `Duplicate decoder for ${registered.messageName} v${registered.schemaVersion}`,
          })
        );
      }
      producerCodecs.set(registered.eventType, registered);
      decoderCodecs.set(decoderKey, registered);
    }
    return ok(new ProjectionMessageCodecRegistry(producerCodecs, decoderCodecs));
  }

  registeredDecoderIdentities(): ReadonlyArray<ProjectionMessageDecoderIdentity> {
    return [...this.decoderCodecs.values()].map((codec) => ({
      messageName: codec.messageName,
      schemaVersion: codec.schemaVersion,
    }));
  }

  encode(event: IDomainEvent): Result<EncodedProjectionMessage, DomainError> {
    const codec = this.producerCodecs.resolve(event);
    if (!codec) {
      return err(
        domainError.invariant({
          code: 'projection_message.codec_not_registered',
          message: `No codec registered for ${event.name.toString()}`,
        })
      );
    }
    const payloadResult = codec.encode(event);
    if (payloadResult.isErr()) {
      return err(payloadResult.error);
    }
    return ok({
      producerEventName: event.name.toString(),
      messageName: codec.messageName,
      schemaVersion: codec.schemaVersion,
      payload: payloadResult.value,
      route: codec.route(event),
    });
  }

  decode(
    messageName: string,
    schemaVersion: number,
    payload: ProjectionMessageJson
  ): Result<ProjectionMessageJson, DomainError> {
    const codec = this.decoderCodecs.get(`${messageName}\0${schemaVersion}`);
    if (!codec) {
      return err(
        domainError.invariant({
          code: 'projection_message.schema_version_unsupported',
          message: `No decoder for ${messageName} v${schemaVersion}`,
        })
      );
    }
    return codec.decode(payload);
  }
}
