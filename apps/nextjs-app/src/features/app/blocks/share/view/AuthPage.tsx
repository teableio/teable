import { useMutation } from '@tanstack/react-query';
import { HttpError, sharePasswordSchema } from '@teable-group/core';
import { shareViewAuth } from '@teable-group/openapi';
import { Button, Input, Label } from '@teable-group/ui-lib';
import { Spin } from '@teable-group/ui-lib/base';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { fromZodError } from 'zod-validation-error';

export const AuthPage = () => {
  const [error, setError] = useState('');
  const router = useRouter();
  const shareId = router.query.shareId as string;
  const { mutateAsync: authShareView, isLoading } = useMutation({
    mutationFn: shareViewAuth,
  });

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const validatePassword = sharePasswordSchema.safeParse(password);
    if (!validatePassword.success) {
      setError(fromZodError(validatePassword.error).message);
      return;
    }
    try {
      await authShareView({ shareId, password });
      router.push({
        pathname: '/share/[shareId]/view',
        query: { shareId },
      });
    } catch (error) {
      if (error instanceof HttpError) {
        setError(error.message);
      } else {
        setError(error as string);
      }
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        <h2 className="text-center text-3xl font-extrabold">
          Enter your password to view this page
        </h2>
        <form className="relative space-y-6" onSubmit={onSubmit}>
          <div className="-space-y-px rounded-md shadow-sm">
            <div>
              <Label className="sr-only" htmlFor="password">
                Password
              </Label>
              <Input
                id="password"
                name="password"
                placeholder="Password"
                required
                type="password"
                readOnly={isLoading}
              />
            </div>
          </div>
          <Button className="w-full" type="submit" disabled={isLoading}>
            {isLoading && <Spin />}
            Submit
          </Button>
          {error && (
            <div className="absolute -bottom-1 w-full translate-y-full text-center text-sm text-destructive">
              {error}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
