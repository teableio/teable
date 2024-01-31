import { Body, Controller, Post } from '@nestjs/common';
import {
  AcceptInvitationLinkRo,
  acceptInvitationLinkRoSchema,
  type AcceptInvitationLinkVo,
} from '@teable/openapi';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { InvitationService } from './invitation.service';

@Controller('api/invitation')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post('/link/accept')
  async acceptLink(
    @Body(new ZodValidationPipe(acceptInvitationLinkRoSchema)) invitationRo: AcceptInvitationLinkRo
  ): Promise<AcceptInvitationLinkVo> {
    return await this.invitationService.acceptInvitationLink(invitationRo);
  }
}
