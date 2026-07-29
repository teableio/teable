/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { IBaseRole, IRole } from '@teable/core';
import { generateInvitationId, HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  CollaboratorType,
  isEmailDomainBanned,
  PrincipalType,
  SettingKey,
  type AcceptInvitationLinkRo,
  type EmailInvitationVo,
  type EmailSpaceInvitationRo,
  type ItemSpaceInvitationLinkVo,
} from '@teable/openapi';
import dayjs from 'dayjs';
import { pick } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { ICollaboratorInvitee } from '../../event-emitter/events';
import {
  CollaboratorCreateEvent,
  CollaboratorInvitedEvent,
  Events,
} from '../../event-emitter/events';
import type { IClsStore } from '../../types/cls';
import { generateInvitationCode } from '../../utils/code-generate';
import { AuditScope } from '../audit/audit-scope';
import { Audit } from '../audit/audit.decorator';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { MailSenderService } from '../mail-sender/mail-sender.service';
import { RiskControlService } from '../risk-control/risk-control.service';
import { SettingOpenApiService } from '../setting/open-api/setting-open-api.service';
import { UserService } from '../user/user.service';

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly settingOpenApiService: SettingOpenApiService,
    private readonly cls: ClsService<IClsStore>,
    private readonly mailSenderService: MailSenderService,
    private readonly collaboratorService: CollaboratorService,
    private readonly userService: UserService,
    private readonly riskControlService: RiskControlService,
    private readonly eventEmitter: EventEmitter2,
    private readonly audit: AuditScope
  ) {}

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
      const setting = await this.settingOpenApiService.getSetting();

      if (setting?.disallowSpaceInvitation) {
        throw new CustomHttpException(
          'The current instance disallow space invitation by the administrator',
          HttpErrorCode.RESTRICTED_RESOURCE,
          {
            localization: {
              i18nKey: 'httpErrors.invitation.disallowSpaceInvitation',
            },
          }
        );
      }
    }
  }

  @Audit({
    action: Events.INVITATION_EMAIL_SEND,
    resourceId: (input: { resourceId: string }) => input.resourceId,
    // Capture the inviter's user.id at decorator-resolve time (before the method
    // runs). Inviting a brand-new email path runs `userService.createUser`, which
    // mutates CLS user.id via runWith(cls.get(), ...) — that bleeds into the
    // outer scope, and by the time the audit listener reads cls.get('user.id')
    // it would see the invitee's id instead of the inviter's. Resolving userId
    // up front pins the row to the inviter.
    userId: (_input, ctx) => ctx.cls.get('user.id'),
    params: (input: {
      resourceId: string;
      resourceType: CollaboratorType;
      role: IRole;
      emails: string[];
    }) => ({
      resourceType: input.resourceType,
      role: input.role,
      emails: input.emails,
      ...(input.resourceType === CollaboratorType.Base
        ? { baseId: input.resourceId }
        : { spaceId: input.resourceId }),
    }),
    emit: (_result: unknown, input: { emails: string[] }) => ({ emailCount: input.emails.length }),
  })
  private async emailInvitation({
    emails,
    role,
    resourceId,
    resourceType,
    spaceId,
  }: {
    emails: string[];
    role: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
    spaceId: string;
  }) {
    const user = { ...this.cls.get('user') };

    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.collaboratorService.validateUserAddRole({
      departmentIds,
      userId: user.id,
      addRole: role,
      resourceId,
      resourceType,
    });
    const { bannedEmailDomains } = await this.settingOpenApiService.getSetting([
      SettingKey.BANNED_EMAIL_DOMAINS,
    ]);
    // Inviting a banned-domain email would auto-create its account below,
    // bypassing the sign-up ban — so drop those addresses entirely.
    const lowercasedEmails = emails.map((email) => email.toLowerCase());
    const riskDeniedEmails = await this.riskControlService.filterDeniedEmails(
      'invitation',
      lowercasedEmails
    );
    const invitationEmails = lowercasedEmails.filter(
      (email) => !isEmailDomainBanned(email, bannedEmailDomains) && !riskDeniedEmails.has(email)
    );
    // Keep an abuse trail: which invitees were dropped and who tried to invite
    // them (see the '[banned-domain]' log-based alert rules)
    const droppedEmails = lowercasedEmails.filter((email) => !invitationEmails.includes(email));
    if (droppedEmails.length) {
      this.logger.log(
        `[banned-domain] dropped invitees=${droppedEmails.join(',')} inviter=${user.email} resource=${resourceType}:${resourceId}`
      );
    }
    // A banned-domain inviter keeps a working UI, but none of their invitation
    // emails are delivered (anti-spam shadow behavior).
    const skipSendMail =
      isEmailDomainBanned(user.email, bannedEmailDomains) ||
      (await this.riskControlService.isEmailDenied('invitation', user.email));
    if (skipSendMail) {
      this.logger.log(
        `[banned-domain] shadow-banned inviter=${user.email} emails=${invitationEmails.join(',')} resource=${resourceType}:${resourceId}`
      );
    }
    const sendUsers = await this.prismaService.user.findMany({
      select: { id: true, name: true, email: true },
      where: { email: { in: invitationEmails } },
    });

    const noExistEmails = invitationEmails.filter(
      (email) => !sendUsers.find((u) => u.email.toLowerCase() === email.toLowerCase())
    );

    const invitees: ICollaboratorInvitee[] = [];
    const invitationResult = await this.prismaService.$tx(async () => {
      // create user if not exist
      const newUsers = await this.createNotExistedUser(noExistEmails);
      sendUsers.push(...newUsers);

      const result: EmailInvitationVo = {};
      for (const sendUser of sendUsers) {
        // create collaborator link
        if (resourceType === CollaboratorType.Space) {
          await this.collaboratorService.createSpaceCollaborator({
            collaborators: [
              {
                principalId: sendUser.id,
                principalType: PrincipalType.User,
              },
            ],
            spaceId: resourceId,
            role: role as IRole,
            skipEvent: true,
          });
        } else {
          await this.collaboratorService.createBaseCollaborator({
            collaborators: [
              {
                principalId: sendUser.id,
                principalType: PrincipalType.User,
              },
            ],
            baseId: resourceId,
            role: role as IBaseRole,
            skipEvent: true,
          });
        }
        // generate invitation record
        const { id } = await this.generateInvitation({
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

        invitees.push({
          principalId: sendUser.id,
          principalType: PrincipalType.User,
          email: sendUser.email,
          invitationId: id,
        });
        result[sendUser.email] = { invitationId: id };
      }

      return result;
    });

    // The batch's single post-commit billing signal (seat/quantity listeners).
    this.eventEmitter.emitAsync(Events.COLLABORATOR_CREATE, new CollaboratorCreateEvent(spaceId));
    this.eventEmitter.emitAsync(
      Events.COLLABORATOR_INVITED,
      new CollaboratorInvitedEvent(resourceId, resourceType, user.id, invitees, skipSendMail)
    );

    return invitationResult;
  }

  async emailInvitationBySpace(spaceId: string, data: EmailSpaceInvitationRo) {
    await this.checkSpaceInvitation();

    const space = await this.prismaService.space.findFirst({
      select: { name: true },
      where: { id: spaceId, deletedTime: null },
    });
    if (!space) {
      throw new CustomHttpException('Space not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.space.notFound',
        },
      });
    }

    return this.emailInvitation({
      emails: data.emails,
      role: data.role,
      resourceId: spaceId,
      resourceType: CollaboratorType.Space,
      spaceId,
    });
  }

  async emailInvitationByBase(baseId: string, data: EmailSpaceInvitationRo) {
    await this.checkSpaceInvitation();

    const base = await this.prismaService.base.findFirst({
      select: { spaceId: true, name: true },
      where: { id: baseId, deletedTime: null },
    });
    if (!base) {
      throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.base.notFound',
        },
      });
    }

    return this.emailInvitation({
      emails: data.emails,
      role: data.role,
      resourceId: baseId,
      resourceType: CollaboratorType.Base,
      spaceId: base.spaceId,
    });
  }

  @Audit({
    action: Events.INVITATION_LINK_CREATE,
    resourceId: (input: { resourceId: string }) => input.resourceId,
    params: (input: { resourceId: string; resourceType: CollaboratorType; role: IRole }) => ({
      resourceType: input.resourceType,
      role: input.role,
      ...(input.resourceType === CollaboratorType.Base
        ? { baseId: input.resourceId }
        : { spaceId: input.resourceId }),
    }),
    emit: (result: ItemSpaceInvitationLinkVo) => ({ invitationId: result.invitationId }),
  })
  async generateInvitationLink({
    role,
    resourceId,
    resourceType,
  }: {
    role: IRole;
    resourceId: string;
    resourceType: CollaboratorType;
  }): Promise<ItemSpaceInvitationLinkVo> {
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.collaboratorService.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: role,
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
      inviteUrl: this.mailSenderService.generateInviteUrl(id, invitationCode),
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
    const departmentIds = this.cls.get('organization.departments')?.map((d) => d.id);
    await this.collaboratorService.validateUserAddRole({
      departmentIds,
      userId: this.cls.get('user.id'),
      addRole: role,
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
      inviteUrl: this.mailSenderService.generateInviteUrl(id, invitationCode),
    }));
  }

  async acceptInvitationLink(acceptInvitationLinkRo: AcceptInvitationLinkRo) {
    const currentUserId = this.cls.get('user.id');
    const { invitationCode, invitationId } = acceptInvitationLinkRo;
    if (generateInvitationCode(invitationId) !== invitationCode) {
      throw new CustomHttpException('Invalid invitation code', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.invitation.invalidCode',
        },
      });
    }
    const linkInvitation = await this.prismaService.invitation.findFirst({
      where: {
        id: invitationId,
        deletedTime: null,
      },
    });
    if (!linkInvitation) {
      throw new CustomHttpException('Invitation link not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.invitation.linkNotFound',
        },
      });
    }

    const { expiredTime, baseId, spaceId, role, createdBy, type } = linkInvitation;

    if (expiredTime && expiredTime < new Date()) {
      throw new CustomHttpException('Invitation link has expired', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.invitation.linkExpired',
        },
      });
    }

    if (type === 'email') {
      return { baseId, spaceId };
    }

    const resourceId = spaceId || baseId;
    if (!resourceId) {
      throw new CustomHttpException(
        'Invalid invitation link: resourceId not found',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: !spaceId ? 'httpErrors.space.notFound' : 'httpErrors.base.notFound',
          },
        }
      );
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
          throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
            localization: {
              i18nKey: 'httpErrors.base.notFound',
            },
          });
        });
      baseSpaceId = base.spaceId;
    }
    const exist = await this.prismaService.txClient().collaborator.count({
      where: {
        principalId: currentUserId,
        principalType: PrincipalType.User,
        resourceId: { in: baseSpaceId ? [baseSpaceId, baseId!] : [spaceId!] },
      },
    });
    if (!exist) {
      await this.prismaService.$tx(async () => {
        if (resourceType === CollaboratorType.Space) {
          await this.collaboratorService.createSpaceCollaborator({
            collaborators: [
              {
                principalId: currentUserId,
                principalType: PrincipalType.User,
              },
            ],
            spaceId: spaceId!,
            role: role as IRole,
            createdBy,
            skipEvent: true,
          });
        } else {
          await this.collaboratorService.createBaseCollaborator({
            collaborators: [
              {
                principalId: currentUserId,
                principalType: PrincipalType.User,
              },
            ],
            baseId: baseId!,
            role: role as IBaseRole,
            createdBy,
            skipEvent: true,
          });
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
      // Post-commit and without a notification context: quantity-check
      // listeners must see the new collaborator, while the accepter joined by
      // their own action and gets no invite notification.
      this.eventEmitter.emitAsync(
        Events.COLLABORATOR_CREATE,
        new CollaboratorCreateEvent((spaceId ?? baseSpaceId)!)
      );
    }
    await this.recordInvitationAccept({
      resourceId,
      accepterId: currentUserId,
      inviterId: createdBy,
      resourceType,
    });

    return { baseId, spaceId };
  }

  /**
   * Decorated helper — splits out the audit write so resourceId (only known mid-method)
   * can be passed in as a parameter the decorator reads.
   */
  @Audit({
    action: Events.INVITATION_ACCEPT,
    resourceId: (input: { resourceId: string }) => input.resourceId,
    userId: (input: { accepterId: string }) => input.accepterId,
    params: (input: { resourceType: CollaboratorType; inviterId: string }) => ({
      resourceType: input.resourceType,
      inviterId: input.inviterId,
    }),
    emit: true,
  })
  private async recordInvitationAccept(_input: {
    resourceId: string;
    accepterId: string;
    inviterId: string;
    resourceType: CollaboratorType;
  }) {
    // Decorator does all the work; body is empty.
  }
}
