import { zodResolver } from '@hookform/resolvers/zod';
import clsx from 'clsx';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import type { FC } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

type Props = {
  /** Something */
};

const loginFormSchema = z.object({
  username: z.string().min(2, { message: 'Minimum 2 chars' }),
  password: z.string().min(4, { message: 'Minimum 4 chars' }),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const LoginForm: FC<Props> = (_props) => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const {
    handleSubmit,
    register,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
  });

  const onSubmit = async (formValues: LoginFormValues): Promise<void> => {
    setError(null);
    const { username, password } = formValues;
    const result = await signIn('credentials', {
      username,
      password,
      // callbackUrl: '/',
      redirect: false,
    });
    const {
      ok = false,
      url,
      status = 500,
      error = 'Server or network Error',
    } = result ?? {};

    if (ok) {
      console.log('Will redirect to ' + url);
      router.push('/');
    } else {
      setError(`${status} - ${error}`);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <label>
        Username
        <input
          type="text"
          {...register('username', {
            required: true,
            minLength: 2,
            maxLength: 50,
          })}
          placeholder="Username or email"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors?.username && (
          <p className={'bg-amber-600'}>{errors.username.message}</p>
        )}
      </label>
      <label>
        Password
        <input
          type="password"
          {...register('password', {
            required: true,
            minLength: 2,
            maxLength: 50,
          })}
          placeholder="Password"
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
        />
        {errors?.password && (
          <p className={'bg-amber-600'}>{errors.password.message}</p>
        )}
      </label>
      <button
        type="submit"
        disabled={isSubmitting}
        className={clsx(
          'inline-flex justify-center rounded-md border border-transparent py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2',
          isSubmitting ? 'bg-indigo-100' : 'bg-indigo-600'
        )}
      >
        Login
      </button>
      {error && <div>{error}</div>}
    </form>
  );
};
