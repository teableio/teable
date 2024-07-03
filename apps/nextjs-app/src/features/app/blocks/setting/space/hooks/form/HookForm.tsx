import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import type { ICreateWebhookRo } from '@teable/openapi';
import { ContentType, createWebhook, createWebhookRoSchema } from '@teable/openapi';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from '@teable/ui-lib';
import { useRouter } from 'next/router';
import { useForm } from 'react-hook-form';
import { defaultEvents, FormEventsField } from './FormEventsField';

export type IFormType = 'new' | 'edit';

const defaultValues: Partial<ICreateWebhookRo> = {
  contentType: ContentType.Json,
  events: defaultEvents,
  isEnabled: true,
};

export function HookForm() {
  const router = useRouter();
  const { spaceId } = router.query as { spaceId: string };
  const form = useForm<ICreateWebhookRo>({
    resolver: zodResolver(createWebhookRoSchema),
    defaultValues: {
      ...defaultValues,
      spaceId,
    },
    mode: 'onBlur',
  });

  console.log('router', router);
  console.log('router.asPath', router.asPath);
  console.log('router.pathname', router.pathname);

  const { mutate: createWebhookMutate } = useMutation({
    mutationFn: createWebhook,
    onSuccess: () => {
      router.push({
        pathname: `/setting/${spaceId}/hooks`,
      });
    },
  });

  // const { mutate: updateAccessTokenMutate, isLoading: updateAccessTokenLoading } = useMutation({
  //   mutationFn: (updateRo: UpdateAccessTokenRo) => updateWebhook(accessTokenId, updateRo),
  //   onSuccess: async (data) => {
  //     // onSubmit?.(data.data);
  //   },
  // });

  const onSubmit = (data: ICreateWebhookRo) => {
    createWebhookMutate(data);
  };

  return (
    <Form {...form}>
      <div>
        <div className="space-y-2">
          <h3 className="text-lg font-medium">Add webhook</h3>
          <p className="text-sm text-muted-foreground">
            We'll send a POST request to the URL below with details of any subscribed events. You
            can also specify which data format you'd like to receive (JSON, x-www-form-urlencoded,
            etc). More information can be found in our developer documentation.
          </p>
        </div>
        <Separator className="my-2 mb-4" />
        <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-screen-lg space-y-8 py-4">
          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Notification Url</FormLabel>
                <FormControl>
                  <Input className="w-96" placeholder="https://teable.cn" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contentType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Content Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-96">
                      <SelectValue placeholder="Select a verified email to display" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="application/json">application/json</SelectItem>
                    <SelectItem value="application/x-www-form-urlencoded">
                      application/x-www-form-urlencoded
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="secret"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret</FormLabel>
                <FormControl>
                  <Input className="w-96" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormEventsField />
          <FormField
            control={form.control}
            name="isEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="cursor-pointer">Active</FormLabel>
                  <FormDescription>
                    We will deliver event details when this hook is triggered.
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
          <Button type="submit">Add webhook</Button>
        </form>
      </div>
    </Form>
  );
}
