import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { NextController } from './next.controller';
import type { NextService } from './next.service';

describe('NextController', () => {
  const response = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    return res as unknown as Response & typeof res;
  };

  it('returns 404 for page routes when Next server is not started', async () => {
    const controller = new NextController({ server: undefined } as unknown as NextService);
    const res = response();

    await controller.home({} as Request, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith('Not Found');
  });

  it('delegates page routes to Next server when it is available', async () => {
    const handler = vi.fn();
    const controller = new NextController({
      server: { getRequestHandler: () => handler },
    } as unknown as NextService);
    const req = {} as Request;
    const res = response();

    await controller.home(req, res);

    expect(handler).toHaveBeenCalledWith(req, res);
    expect(res.status).not.toHaveBeenCalled();
  });
});
