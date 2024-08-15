import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IRole } from '@teable/core';
import { generateInvitationId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  AcceptInvitationLinkRo,
  CreateSpaceInvitationLinkRo,
  EmailInvitationVo,
  EmailSpaceInvitationRo,
  ItemSpaceInvitationLinkVo,
  UpdateSpaceInvitationLinkRo,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { IMailConfig } from '../../configs/mail.config';
import type { IClsStore } from '../../types/cls';
import { generateInvitationCode } from '../../utils/code-generate';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { UserService } from '../user/user.service';

@Injectable()
export class InvitationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cls: ClsService<IClsStore>,
    private readonly configService: ConfigService,
    private readonly mailSenderService: MailSenderService,
    private readonly collaboratorService: CollaboratorService,
    private readonly userService: UserService
  ) {}

  private generateInviteUrl(invitationId: string, invitationCode: string) {
    const mailConfig = this.configService.get<IMailConfig>('mail');
    return `${mailConfig?.origin}/invite?invitationId=${invitationId}&invitationCode=${invitationCode}`;
  }

  private async createNotExistedUser(emails: string[]) {
    const users: { email: string; name: string; id: string }[] = [];
    for (const email of emails) {
      const user = await this.userService.createUser({ email });
      users.push(pick(user, 'id', 'name', 'email'));
    }
    return users;
  }

  async emailInvitationBySpace(spaceId: string, data: EmailSpaceInvitationRo) {
    const user = this.cls.get('user');

    if (!user?.isAdmin) {
      const setting = await this.prismaService.setting.findFirst({
        select: {
          disallowSpaceInvitation: true,
        },
      });

      if (setting?.disallowSpaceInvitation) {
        throw new ForbiddenException(
          'The current instance disallow space invitation by the administrator'
        );
      }
    }

    const space = await this.prismaService.space.findFirst({
      select: { name: true },
      where: { id: spaceId, deletedTime: null },
    });
    if (!space) {
      throw new BadRequestException('Space not found');
    }

    const invitationEmails = data.emails.map((email) => email.toLowerCase());
    const sendUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, email: true },
      where: { email: { in: invitationEmails } },
    });

    const noExistEmails = invitationEmails.filter(
      (email) => !sendUsers.find((u) => u.email.toLowerCase() === email.toLowerCase())
    );

    return await this.prismaService.$tx(async () => {
      // create user if not exist
      const newUsers = await this.createNotExistedUser(noExistEmails);
      sendUsers.push(...newUsers);

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
            invitationId: id,
          },
        });
        // get email info
        const inviteEmailOptions = this.mailSenderService.inviteEmailOptions({
          name: user.name,
          email: user.email,
          spaceName: space?.name,
          inviteUrl: this.generateInviteUrl(id, invitationCode),
        });
        this.mailSenderService.sendMail({
          to: sendUser.email,
          ...inviteEmailOptions,
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
      role: role as IRole,
      createdBy,
      createdTime: createdTime.toISOString(),
      inviteUrl: this.generateInviteUrl(id, invitationCode),
      invitationCode,
    };
  }

  async generateInvitationBySpace(
    type: 'link' | 'email',
    spaceId: string,
    data: CreateSpaceInvitationLinkRo
  ) {
    const userId = this.cls.get('user.id');
    const { role } = data;
    const invitationId = generateInvitationId();
    return await this.prismaService.txClient().invitation.create({
      data: {
        id: invitationId,
        invitationCode: generateInvitationCode(invitationId),
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
      role: role as IRole,
    };
  }

  async getInvitationLinkBySpace(spaceId: string) {
    const data = await this.prismaService.invitation.findMany({
      select: { id: true, role: true, createdBy: true, createdTime: true, invitationCode: true },
      where: { spaceId, type: 'link', deletedTime: null },
    });
    return data.map(({ id, role, createdBy, createdTime, invitationCode }) => ({
      invitationId: id,
      role: role as IRole,
      createdBy,
      createdTime: createdTime.toISOString(),
      invitationCode,
      inviteUrl: this.generateInviteUrl(id, invitationCode),
    }));
  }

  async acceptInvitationLink(acceptInvitationLinkRo: AcceptInvitationLinkRo) {
    const currentUserId = this.cls.get('user.id');
    const { invitationCode, invitationId } = acceptInvitationLinkRo;
    if (generateInvitationCode(invitationId) !== invitationCode) {
      throw new BadRequestException('invalid code');
    }
    const linkInvitation = await this.prismaService.invitation.findFirst({
      where: {
        id: invitationId,
        deletedTime: null,
      },
    });
    if (!linkInvitation) {
      throw new NotFoundException(`link ${invitationId} not found`);
    }

    const { expiredTime, baseId, spaceId, role, createdBy, type } = linkInvitation;

    if (expiredTime && expiredTime < new Date()) {
      throw new ForbiddenException('link has expired');
    }

    if (type === 'email') {
      return { baseId, spaceId };
    }

    const exist = await this.prismaService
      .txClient()
      .collaborator.count({ where: { userId: currentUserId, spaceId, baseId, deletedTime: null } });
    if (!exist) {
      await this.prismaService.$tx(async () => {
        await this.prismaService.txClient().collaborator.create({
          data: {
            spaceId,
            baseId,
            roleName: role,
            userId: currentUserId,
            createdBy: createdBy,
          },
        });
        // save invitation record for audit
        await this.prismaService.txClient().invitationRecord.create({
          data: {
            invitationId: linkInvitation.id,
            inviter: createdBy,
            accepter: currentUserId,
            type: 'link',
            spaceId,
            baseId,
          },
        });
      });
    }
    return { baseId, spaceId };
  }
}
