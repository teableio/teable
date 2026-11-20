import { BaseNodeResourceType, ResourceType, TrashType } from '@teable/openapi';
import { describe, expect, it } from 'vitest';
import { RESOURCE_DESCRIPTORS, resourceDescriptorOf } from './resource-descriptor';

// Both enums take their members from ResourceType, so each also maps its values back to its names.
const resourceTypes: string[] = Object.values(ResourceType);
const valuesOf = (enumObject: object) =>
  Object.values(enumObject).filter((value: string) => resourceTypes.includes(value));

describe('RESOURCE_DESCRIPTORS', () => {
  it('describes every trash type, and nothing else', () => {
    expect(Object.keys(RESOURCE_DESCRIPTORS).sort()).toEqual(valuesOf(TrashType).sort());
  });

  it('gives node events to exactly the node kinds, looked up by their node type', () => {
    const withNode = Object.keys(RESOURCE_DESCRIPTORS).filter(
      (type) => resourceDescriptorOf(type)?.nodeEvents
    );
    expect(withNode.sort()).toEqual(valuesOf(BaseNodeResourceType).sort());
  });

  it('names the table of every node kind, so anything in a tree can be read by id', () => {
    for (const type of valuesOf(BaseNodeResourceType)) {
      expect(resourceDescriptorOf(type)?.dbTable, type).toBeDefined();
    }
  });
});
