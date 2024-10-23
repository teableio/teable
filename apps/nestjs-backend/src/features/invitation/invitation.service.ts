import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IBaseRole, IRole } from '@teable/core';
import { canManageRole, generateInvitationId } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  CollaboratorType,
  type AcceptInvitationLinkRo,
  type EmailInvitationVo,
  type EmailSpaceInvitationRo,
  type ItemSpaceInvitationLinkVo,
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

  private async validateUserInviteRole({
    userId,
    inviteRole,
    resourceId,
    resourceType,
  }: {
    userId: string;
    inviteRole: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    let spaceId = resourceType === CollaboratorType.Space ? resourceId : '';
    if (resourceType === CollaboratorType.Base) {
      const base = await this.prismaService
        .txClient()
        .base.findFirstOrThrow({
          where: {
            id: resourceId,
            deletedTime: null,
          },
        })
        .catch(() => {
          throw new BadRequestException('Base not found');
        });
      spaceId = base.spaceId;
    }
    const coll = await this.prismaService
      .txClient()
      .collaborator.findFirstOrThrow({
        where: {
          userId,
          resourceId: {
            in: [spaceId, resourceId],
          },
        },
      })
      .catch(() => {
        throw new BadRequestException('User not found in collaborator');
      });
    const userRole = coll.roleName as IRole;

    if (userRole === inviteRole) {
      return;
    }
    if (!canManageRole(userRole, inviteRole)) {
      throw new ForbiddenException(`You do not have permission to invite this role: ${inviteRole}`);
    }
  }

  private async createNotExistedUser(emails: string[]) {
    const users: { email: string; name: string; id: string }[] = [];
    for (const email of emails) {
      const user = await this.userService.createUser({ email });
      users.push(pick(user, 'id', 'name', 'email'));
    }
    return users;
  }

  private async checkSpaceInvitation() {
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
  }

  private async emailInvitation({
    emails,
    role,
    resourceId,
    resourceName,
    resourceType,
  }: {
    emails: string[];
    role: IRole;
    resourceId: string;
    resourceName: string;
    resourceType: CollaboratorType;
  }) {
    const user = this.cls.get('user');
    await this.validateUserInviteRole({
      userId: user.id,
      inviteRole: role,
      resourceId,
      resourceType,
    });
    const invitationEmails = emails.map((email) => email.toLowerCase());
    const sendUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, email: true },
      where: { email: { in: invitationEmails } },
    });

    const noExistEmails = invitationEmails.filter(
      (email) => !sendUsers.find((u) => u.email.toLowerCase() === email.toLowerCase())
    );

    return this.prismaService.$tx(async () => {
      // create user if not exist
      const newUsers = await this.createNotExistedUser(noExistEmails);
      sendUsers.push(...newUsers);

      const result: EmailInvitationVo = {};
      for (const sendUser of sendUsers) {
        // create collaborator link
        if (resourceType === CollaboratorType.Space) {
          await this.collaboratorService.createSpaceCollaborator(sendUser.id, resourceId, role);
        } else {
          await this.collaboratorService.createBaseCollaborator(
            sendUser.id,
            resourceId,
            role as IBaseRole
          );
        }
        // generate invitation record
        const { id, invitationCode } = await this.generateInvitation({
          type: 'email',
          role,
          resourceId,
          resourceType,
        });

        // save invitation record for audit
        await this.prismaService.txClient().invitationRecord.create({
          data: {
            inviter: user.id,
            accepter: sendUser.id,
            type: 'email',
            spaceId: resourceType === CollaboratorType.Space ? resourceId : null,
            baseId: resourceType === CollaboratorType.Base ? resourceId : null,
            invitationId: id,
          },
        });
        // get email info
        const inviteEmailOptions = this.mailSenderService.inviteEmailOptions({
          name: user.name,
          email: user.email,
          resourceName,
          resourceType,
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

  async emailInvitationBySpace(spaceId: string, data: EmailSpaceInvitationRo) {
    await this.checkSpaceInvitation();

    const space = await this.prismaService.space.findFirst({
      select: { name: true },
      where: { id: spaceId, deletedTime: null },
    });
    if (!space) {
      throw new BadRequestException('Space not found');
    }

    return this.emailInvitation({
      emails: data.emails,
      role: data.role,
      resourceId: spaceId,
      resourceName: space.name,
      resourceType: CollaboratorType.Space,
    });
  }

  async emailInvitationByBase(baseId: string, data: EmailSpaceInvitationRo) {
    await this.checkSpaceInvitation();

    const base = await this.prismaService.base.findFirst({
      select: { spaceId: true, name: true },
      where: { id: baseId, deletedTime: null },
    });
    if (!base) {
      throw new BadRequestException('Base not found');
    }

    return this.emailInvitation({
      emails: data.emails,
      role: data.role,
      resourceId: baseId,
      resourceName: base.name,
      resourceType: CollaboratorType.Base,
    });
  }

  async generateInvitationLink({
    role,
    resourceId,
    resourceType,
  }: {
    role: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }): Promise<ItemSpaceInvitationLinkVo> {
    await this.validateUserInviteRole({
      userId: this.cls.get('user.id'),
      inviteRole: role,
      resourceId,
      resourceType,
    });
    const { id, createdBy, createdTime, invitationCode } = await this.generateInvitation({
      role,
      resourceId,
      resourceType,
      type: 'link',
    });
    return {
      invitationId: id,
      role: role as IRole,
      createdBy,
      createdTime: createdTime.toISOString(),
      inviteUrl: this.generateInviteUrl(id, invitationCode),
      invitationCode,
    };
  }

  private async generateInvitation({
    type,
    role,
    resourceId,
    resourceType,
  }: {
    type: 'link' | 'email';
    role: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    const userId = this.cls.get('user.id');
    const invitationId = generateInvitationId();
    return this.prismaService.txClient().invitation.create({
      data: {
        id: invitationId,
        invitationCode: generateInvitationCode(invitationId),
        spaceId: resourceType === CollaboratorType.Space ? resourceId : null,
        baseId: resourceType === CollaboratorType.Base ? resourceId : null,
        role,
        type,
        expiredTime:
          type === 'email' ? dayjs(new Date()).add(1, 'month').toDate().toISOString() : null,
        createdBy: userId,
      },
    });
  }

  async deleteInvitationLink({
    invitationId,
    resourceId,
    resourceType,
  }: {
    invitationId: string;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    await this.prismaService.invitation.update({
      where: {
        id: invitationId,
        type: 'link',
        [resourceType === CollaboratorType.Space ? 'spaceId' : 'baseId']: resourceId,
      },
      data: { deletedTime: new Date().toISOString() },
    });
  }

  async updateInvitationLink({
    invitationId,
    role,
    resourceId,
    resourceType,
  }: {
    invitationId: string;
    role: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }) {
    await this.validateUserInviteRole({
      userId: this.cls.get('user.id'),
      inviteRole: role,
      resourceId,
      resourceType,
    });
    const { id } = await this.prismaService.invitation.update({
      where: {
        id: invitationId,
        type: 'link',
        [resourceType === CollaboratorType.Space ? 'spaceId' : 'baseId']: resourceId,
      },
      data: {
        role,
      },
    });
    return {
      invitationId: id,
      role,
    };
  }

  async getInvitationLink(resourceId: string, resourceType: CollaboratorType) {
    const data = await this.prismaService.invitation.findMany({
      select: { id: true, role: true, createdBy: true, createdTime: true, invitationCode: true },
      where: {
        [resourceType === CollaboratorType.Space ? 'spaceId' : 'baseId']: resourceId,
        type: 'link',
        deletedTime: null,
      },
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

    const resourceId = spaceId || baseId;
    if (!resourceId) {
      throw new BadRequestException('Invalid link: resourceId not found');
    }

    const resourceType = spaceId ? CollaboratorType.Space : CollaboratorType.Base;
    let baseSpaceId: string | null = null;
    if (baseId) {
      const base = await this.prismaService
        .txClient()
        .base.findUniqueOrThrow({
          where: { id: baseId, deletedTime: null },
        })
        .catch(() => {
          throw new NotFoundException(`base ${baseId} not found`);
        });
      baseSpaceId = base.spaceId;
    }
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        userId: currentUserId,
        resourceId: { in: baseSpaceId ? [baseSpaceId, baseId!] : [spaceId!] },
      },
    });
    if (!exist) {
      await this.prismaService.$tx(async () => {
        if (resourceType === CollaboratorType.Space) {
          await this.collaboratorService.createSpaceCollaborator(
            currentUserId,
            spaceId!,
            role as IRole,
            createdBy
          );
        } else {
          await this.collaboratorService.createBaseCollaborator(
            currentUserId,
            baseId!,
            role as IBaseRole,
            createdBy
          );
        }
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
