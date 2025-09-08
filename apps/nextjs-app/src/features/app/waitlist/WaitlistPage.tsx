import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { IJoinWaitlistRo } from '@teable/openapi';
import { getPublicSetting, joinWaitlist, joinWaitlistSchemaRo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Input,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@teable/ui-lib';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { TeableLogo } from '@/components/TeableLogo';
import { useBrand } from '@/features/app/hooks/useBrand';
import { NotFoundPage } from '@/features/system/pages/NotFoundPage';
import { useIsCloud } from '../hooks/useIsCloud';

const WaitlistPageInner = () => {
  const { t } = useTranslation('common');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const router = useRouter();

  const { mutate: joinWaitlistMutation, isLoading } = useMutation({
    mutationFn: (ro: IJoinWaitlistRo) => joinWaitlist(ro),
    onSuccess: () => {
      setIsSubmitted(true);
    },
  });

  const form = useForm<IJoinWaitlistRo>({
    resolver: zodResolver(joinWaitlistSchemaRo),
    defaultValues: {
      email: router.query.email as string,
    },
  });

  const onSubmit = () => {
    const data = form.getValues();
    if (!joinWaitlistSchemaRo.safeParse(data).success) {
      toast.error('Please enter a valid email address');
      return;
    }
    joinWaitlistMutation({ email: data.email });
  };

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100">
              <svg
                className="size-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              {t('waitlist.youAreOnTheList')}
            </CardTitle>
            <CardDescription className="text-lg">{t('waitlist.thanksForJoining')}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => setIsSubmitted(false)} variant="outline" className="w-full">
              {t('waitlist.back')}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="mb-16 text-center">
        <h1 className="mb-4 text-4xl font-bold text-gray-900">{t('waitlist.joinTitle')}</h1>
        <h2 className="text-xl  text-gray-900">{t('waitlist.joinDesc')}</h2>
      </div>

      <Card className="w-full max-w-md">
        <CardContent>
          <Form {...form}>
            <form className="mt-6 space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder={t('waitlist.emailPlaceholder')}
                        {...field}
                        className="h-12"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="button"
                onClick={onSubmit}
                className="h-12 w-full text-lg font-semibold"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center space-x-2">
                    <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    <span>{t('waitlist.joining')}</span>
                  </div>
                ) : (
                  t('waitlist.join')
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
};

export const WaitlistPage = () => {
  const { brandName } = useBrand();
  const isCloud = useIsCloud();
  const { data: setting } = useQuery({
    queryKey: ReactQueryKeys.getPublicSetting(),
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });
  const { enableWaitlist = false } = setting ?? {};

  if (!isCloud || !enableWaitlist) {
    return <NotFoundPage />;
  }

  return (
    <div className=" h-screen w-screen">
      <div className="fixed left-5 top-5 flex flex-none items-center gap-2">
        <TeableLogo className="size-8" />
        {brandName}
      </div>
      <WaitlistPageInner />
    </div>
  );
};
