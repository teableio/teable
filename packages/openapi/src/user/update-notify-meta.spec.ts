import { describe, expect, it } from 'vitest';
import { userNotifyMetaSchema } from './update-notify-meta';

describe('userNotifyMetaSchema', () => {
  it('accepts the app builder intro dismissed flag', () => {
    const result = userNotifyMetaSchema.safeParse({
      email: true,
      appBuilderChatIntroDismissed: true,
    });

    expect(result.success).toBe(true);
  });
});
