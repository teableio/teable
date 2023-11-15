import { z } from '../zod';

export const sharePasswordSchema = z.string().min(3);
