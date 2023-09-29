import { useMutation } from '@tanstack/react-query';
import type { HttpError } from '@teable-group/core';
import type { ISignin } from '@teable-group/openapi';
import { signup, signin, signinSchema, signupSchema } from '@teable-group/openapi';
import { Spin } from '@teable-group/ui-lib/base';
import { Button, Input, Label } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import type { FC } from 'react';
import { useCallback, useMemo, useState } from 'react';
import { fromZodError } from 'zod-validation-error';

export interface ISignForm {
  className?: string;
  type?: 'signin' | 'signup';
  onSuccess?: () => void;
}
export const SignForm: FC<ISignForm> = (props) => {
  const { className, type = 'signin', onSuccess } = props;
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>();
  const submitMutation = useMutation({
    mutationFn: ({ type, form }: { type: 'signin' | 'signup'; form: ISignin }) => {
      if (type === 'signin') {
        return signin(form);
      }
      if (type === 'signup') {
        return signup(form);
      }
      throw new Error('Invalid type');
    },
  });

  const validation = useCallback(
    (form: ISignin) => {
      if (type === 'signin') {
        const res = signinSchema.safeParse(form);
        if (!res.success) {
          return { error: fromZodError(res.error).message };
        }
      }
      const res = signupSchema.safeParse(form);
      if (!res.success) {
        return { error: fromZodError(res.error).message };
      }
      return {};
    },
    [type]
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const form = { email, password };

    const { error } = validation(form);
    if (error) {
      setError(error);
      return;
    }
    try {
      setIsLoading(true);
      await submitMutation.mutateAsync({ type, form });
      onSuccess?.();
    } catch (err) {
      setError((err as HttpError).message);
      setIsLoading(false);
    }
  }

  const buttonText = useMemo(() => (type === 'signin' ? 'Sign In' : 'Sign Up'), [type]);

  return (
    <div className={classNames('grid gap-3', className)}>
      <form className="relative" onSubmit={onSubmit} onChange={() => setError(undefined)}>
        <div className="grid gap-3">
          <div className="grid gap-3">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              placeholder="Enter your email address..."
              type="text"
              autoComplete="username"
              disabled={isLoading}
            />
          </div>
          <div className="grid gap-3">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              placeholder="Enter your password..."
              type="password"
              autoComplete="password"
              disabled={isLoading}
            />
          </div>
          <Button disabled={isLoading}>
            {isLoading && <Spin />}
            {buttonText}
          </Button>
          {error && (
            <div className="absolute w-full -bottom-1 translate-y-full text-destructive text-sm text-center">
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
};
