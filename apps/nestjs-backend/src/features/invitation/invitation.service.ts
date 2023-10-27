import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SpaceRole } from '@teable-group/core';
import { generateInvitationCode, generateInvitationId } from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import type {
  CreateSpaceInvitationLinkRo,
  EmailInvitationVo,
  EmailSpaceInvitationRo,
  ItemSpaceInvitationLinkVo,
  UpdateSpaceInvitationLinkRo,
} from '@teable-group/openapi';
import dayjs from 'dayjs';
import MarkdownIt from 'markdown-it';
import { ClsService } from 'nestjs-cls';
import type { IMailConfig } from '../../configs/mail.config';
import type { IClsStore } from '../../types/cls';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';

@Injectable()
export class InvitationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly configService: ConfigService,
    private readonly mailSenderService: MailSenderService,
    private readonly collaboratorService: CollaboratorService
  ) {}

  private spaceEmailOptions(info: {
    name: string;
    email: string;
    spaceName: string;
    inviteUrl: string;
  }) {
    const { name, email, inviteUrl, spaceName } = info;
    return {
      title: `${name} (${email}) invited you to their space ${spaceName} - Teable`,
      content: MarkdownIt({ html: true, breaks: true }).render(`
### Invitation to Collaborate

**${name}** (${email}) has invited you to collaborate on their space **${spaceName}**.


[Open space](${inviteUrl})
      `),
    };
  }

  private generateInviteUrl(invitationId: string, invitationCode: string) {
    const mailConfig = this.configService.get<IMailConfig>('mail');
    return `${mailConfig?.origin}/invite?invitationId=${invitationId}&invitationCode=${invitationCode}`;
  }

  async emailInvitationBySpace(spaceId: string, data: EmailSpaceInvitationRo) {
    const user = this.cls.get('user');
    const space = await this.prismaService.space.findFirst({
      select: { name: true },
      where: { id: spaceId, deletedTime: null },
    });
    if (!space) {
      throw new BadRequestException('Space not found');
    }

    const sendUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, email: true },
      where: { email: { in: data.emails } },
    });
    if (sendUsers.length === 0) {
      throw new BadRequestException('Email not exist');
    }

    return await this.prismaService.$tx(async () => {
      const { role } = data;
      const result: EmailInvitationVo = {};
      for (const sendUser of sendUsers) {
        // create collaborator link
        await this.collaboratorService.createSpaceCollaborator(sendUser.id, spaceId, role);
        // generate invitation record
        const { id, invitationCode } = await this.generateInvitationBySpace('email', spaceId, {
          role,
        });

        // save invitation record for audit
        await this.prismaService.txClient().invitationRecord.create({
          data: {
            inviter: user.id,
            accepter: sendUser.id,
            type: 'email',
            spaceId,
          },
        });
        // get email info
        const { title, content } = this.spaceEmailOptions({
          name: user.name,
          email: user.email,
          spaceName: space?.name,
          inviteUrl: this.generateInviteUrl(id, invitationCode),
        });
        this.mailSenderService.sendMail({
          to: sendUser.email,
          subject: title,
          html: content,
        });
        result[sendUser.email] = { invitationId: id };
      }
      return result;
    });
  }

  async generateInvitationLinkBySpace(
    spaceId: string,
    data: CreateSpaceInvitationLinkRo
  ): Promise<ItemSpaceInvitationLinkVo> {
    const { id, role, createdBy, createdTime, invitationCode } =
      await this.generateInvitationBySpace('link', spaceId, data);
    return {
      invitationId: id,
      role: role as SpaceRole,
      createdBy,
      createdTime: createdTime.toISOString(),
      inviteUrl: this.generateInviteUrl(id, invitationCode),
    };
  }

  async generateInvitationBySpace(
    type: 'link' | 'email',
    spaceId: string,
    data: CreateSpaceInvitationLinkRo
  ) {
    const userId = this.cls.get('user.id');
    const { role } = data;
    return await this.prismaService.txClient().invitation.create({
      data: {
        id: generateInvitationId(),
        invitationCode: generateInvitationCode(),
        spaceId,
        role,
        type,
        expiredTime:
          type === 'email' ? dayjs(new Date()).add(1, 'month').toDate().toISOString() : null,
        createdBy: userId,
      },
    });
  }

  async deleteInvitationLinkBySpace(spaceId: string, invitationId: string) {
    await this.prismaService.invitation.update({
      where: { id: invitationId, spaceId, type: 'link' },
      data: { deletedTime: new Date().toISOString() },
    });
  }

  async updateInvitationLinkBySpace(
    spaceId: string,
    invitationId: string,
    updateSpaceInvitationLinkRo: UpdateSpaceInvitationLinkRo
  ) {
    const { id, role } = await this.prismaService.invitation.update({
      where: { id: invitationId, spaceId, type: 'link' },
      data: updateSpaceInvitationLinkRo,
    });
    return {
      invitationId: id,
      role: role as SpaceRole,
    };
  }

  async getInvitationLinkBySpace(spaceId: string) {
    const data = await this.prismaService.invitation.findMany({
      select: { id: true, role: true, createdBy: true, createdTime: true, invitationCode: true },
      where: { spaceId, type: 'link', deletedTime: null },
    });
    return data.map(({ id, role, createdBy, createdTime, invitationCode }) => ({
      invitationId: id,
      role: role as SpaceRole,
      createdBy,
      createdTime: createdTime.toISOString(),
      invitationCode,
      inviteUrl: this.generateInviteUrl(id, invitationCode),
    }));
  }
}
