import { ChevronRight, Plus } from '@teable/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import { CornerDownRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';
import { useChatPanelStore } from '../../components/ai-chat/store/useChatPanelStore';

interface IPromptBoxProps {
  onEnter: (text: string) => void;
}

export const PromptBox: React.FC<IPromptBoxProps> = ({ onEnter }) => {
  const { t } = useTranslation(['common']);
  const [prompt, setPrompt] = useState('');
  const { open } = useChatPanelStore();
  const suggestions = [
    {
      title: t('common:template.promptBox.ideasList.crm.title'),
      subPrompt: [
        {
          title: t('common:template.promptBox.ideasList.crm.crmForArtists.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForArtists.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForRealEstate.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForRealEstate.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForLawyers.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForLawyers.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForPhotographers.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForPhotographers.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForHealthcare.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForHealthcare.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForInfluencers.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForInfluencers.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForWeddingPlanners.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForWeddingPlanners.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForFitnessTrainers.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForFitnessTrainers.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForMusicians.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForMusicians.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.crm.crmForConstruction.title'),
          prompt: t('common:template.promptBox.ideasList.crm.crmForConstruction.prompt'),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.devProductivity.title'),
      subPrompt: [
        {
          title: t('common:template.promptBox.ideasList.devProductivity.codeReviewTracker.title'),
          prompt: t('common:template.promptBox.ideasList.devProductivity.codeReviewTracker.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.devProductivity.bugTrackingSystem.title'),
          prompt: t('common:template.promptBox.ideasList.devProductivity.bugTrackingSystem.prompt'),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.devProductivity.sprintPlanningDashboard.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.devProductivity.sprintPlanningDashboard.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.devProductivity.apiDocumentationManager.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.devProductivity.apiDocumentationManager.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.devProductivity.techDebtTracker.title'),
          prompt: t('common:template.promptBox.ideasList.devProductivity.techDebtTracker.prompt'),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.devProductivity.developerOnboardingSystem.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.devProductivity.developerOnboardingSystem.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.educational.title'),
      subPrompt: [
        {
          title: t(
            'common:template.promptBox.ideasList.educational.studentPerformanceTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.educational.studentPerformanceTracker.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.educational.courseContentManagement.title'),
          prompt: t(
            'common:template.promptBox.ideasList.educational.courseContentManagement.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.educational.onlineLearningPlatform.title'),
          prompt: t(
            'common:template.promptBox.ideasList.educational.onlineLearningPlatform.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.educational.researchProjectManager.title'),
          prompt: t(
            'common:template.promptBox.ideasList.educational.researchProjectManager.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.educational.schoolAdministrationSystem.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.educational.schoolAdministrationSystem.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.educational.trainingProgramTracker.title'),
          prompt: t(
            'common:template.promptBox.ideasList.educational.trainingProgramTracker.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.personalFinance.title'),
      subPrompt: [
        {
          title: t(
            'common:template.promptBox.ideasList.personalFinance.investmentPortfolioTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.personalFinance.investmentPortfolioTracker.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.personalFinance.budgetManagementSystem.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.personalFinance.budgetManagementSystem.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.personalFinance.debtPayoffPlanner.title'),
          prompt: t('common:template.promptBox.ideasList.personalFinance.debtPayoffPlanner.prompt'),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.personalFinance.retirementPlanningDashboard.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.personalFinance.retirementPlanningDashboard.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.personalFinance.taxPreparationOrganizer.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.personalFinance.taxPreparationOrganizer.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.personalFinance.sideHustleRevenueTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.personalFinance.sideHustleRevenueTracker.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.productivity.title'),
      subPrompt: [
        {
          title: t('common:template.promptBox.ideasList.productivity.taskManagementSystem.title'),
          prompt: t('common:template.promptBox.ideasList.productivity.taskManagementSystem.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.productivity.habitTrackingDashboard.title'),
          prompt: t(
            'common:template.promptBox.ideasList.productivity.habitTrackingDashboard.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.productivity.timeBlockingPlanner.title'),
          prompt: t('common:template.promptBox.ideasList.productivity.timeBlockingPlanner.prompt'),
        },
        {
          title: t('common:template.promptBox.ideasList.productivity.goalAchievementTracker.title'),
          prompt: t(
            'common:template.promptBox.ideasList.productivity.goalAchievementTracker.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.productivity.energyManagementSystem.title'),
          prompt: t(
            'common:template.promptBox.ideasList.productivity.energyManagementSystem.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.productivity.digitalMinimalismTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.productivity.digitalMinimalismTracker.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.healthAndWellness.title'),
      subPrompt: [
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.fitnessProgressTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.fitnessProgressTracker.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.nutritionAndMealPlanning.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.nutritionAndMealPlanning.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.mentalHealthJournal.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.mentalHealthJournal.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.sleepOptimizationSystem.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.sleepOptimizationSystem.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.medicalRecordsManager.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.medicalRecordsManager.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.healthAndWellness.wellnessChallengeTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.healthAndWellness.wellnessChallengeTracker.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.contentGenerationAndEditing.title'),
      subPrompt: [
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.blogContentPipeline.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.blogContentPipeline.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.socialMediaContentCalendar.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.socialMediaContentCalendar.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.videoProductionTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.videoProductionTracker.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.podcastManagementSystem.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.podcastManagementSystem.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.newsletterCampaignManager.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.newsletterCampaignManager.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.creativeWritingProjectTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.contentGenerationAndEditing.creativeWritingProjectTracker.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.travelPlanning.title'),
      subPrompt: [
        {
          title: t(
            'common:template.promptBox.ideasList.travelPlanning.tripItineraryOrganizer.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.tripItineraryOrganizer.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.travelPlanning.travelExpenseTracker.title'),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.travelExpenseTracker.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.travelPlanning.travelExperienceJournal.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.travelExperienceJournal.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.travelPlanning.businessTravelManager.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.businessTravelManager.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.travelPlanning.groupTravelCoordinator.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.groupTravelCoordinator.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.travelPlanning.travelPlanningResearchHub.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.travelPlanning.travelPlanningResearchHub.prompt'
          ),
        },
      ],
    },
    {
      title: t('common:template.promptBox.ideasList.entertainment.title'),
      subPrompt: [
        {
          title: t('common:template.promptBox.ideasList.entertainment.movieAndTvShowTracker.title'),
          prompt: t(
            'common:template.promptBox.ideasList.entertainment.movieAndTvShowTracker.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.entertainment.bookReadingProgress.title'),
          prompt: t('common:template.promptBox.ideasList.entertainment.bookReadingProgress.prompt'),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.entertainment.gamingAchievementTracker.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.entertainment.gamingAchievementTracker.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.entertainment.musicDiscoveryAndOrganization.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.entertainment.musicDiscoveryAndOrganization.prompt'
          ),
        },
        {
          title: t(
            'common:template.promptBox.ideasList.entertainment.eventAndConcertPlanner.title'
          ),
          prompt: t(
            'common:template.promptBox.ideasList.entertainment.eventAndConcertPlanner.prompt'
          ),
        },
        {
          title: t('common:template.promptBox.ideasList.entertainment.hobbyProjectManager.title'),
          prompt: t('common:template.promptBox.ideasList.entertainment.hobbyProjectManager.prompt'),
        },
      ],
    },
  ] as const;
  return (
    <div className="mx-auto flex w-full justify-center px-4 sm:px-6 lg:px-8">
      <div className="shadow-black/6 w-full max-w-3xl rounded-2xl border bg-card p-4 text-left shadow-sm">
        <div className="relative space-y-2 rounded-2xl bg-muted px-6 py-3">
          <textarea
            id="prompt-box"
            className="h-[60px] w-full resize-none bg-muted text-sm focus:outline-none focus:ring-0"
            placeholder={t('common:template.promptBox.placeholder')}
            rows={3}
            value={prompt}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.stopPropagation();
                e.preventDefault();
                onEnter(prompt);
                open();
              }
            }}
            onChange={(e) => setPrompt(e.target.value)}
          />

          <div className="flex items-center justify-between">
            {/* Plus Icon */}
            <Plus className="size-5 opacity-0" strokeWidth={1.5} />

            {/* Start Button */}
            <Button
              variant={'ghost'}
              size={'xs'}
              className="flex items-center gap-2 rounded-lg text-secondary-foreground hover:bg-muted-foreground/5"
              onClick={() => {
                onEnter(prompt);
                open();
              }}
            >
              <span className="text-sm">{t('common:template.promptBox.start')}</span>
              <CornerDownRight className="size-5" strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <p className="text-sm text-card-foreground/30 dark:text-card/30">
            {t('common:template.promptBox.ideas')}
          </p>

          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <DropdownMenu key={suggestion.title}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={'ghost'}
                    size={'xs'}
                    className="bg-sc flex items-center gap-1 rounded-md bg-secondary/50 p-1 py-1.5 text-xs transition-colors"
                  >
                    <ChevronRight className="size-3" />
                    <span className="text-xs">{suggestion.title}</span>
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent className="w-56" align="start">
                  {suggestion.subPrompt.map((subPrompt) => (
                    <DropdownMenuItem
                      key={subPrompt.title}
                      onClick={() => {
                        setPrompt(subPrompt.prompt);
                      }}
                    >
                      <span className="text-xs text-secondary-foreground">{subPrompt.title}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
