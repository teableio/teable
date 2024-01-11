import { signin as apiSignin, signup as apiSignup, USER_ME } from '@teable-group/openapi';
import axiosInstance from 'axios';

export async function createNewUserAxios(user: { email: string; password: string }) {
  const signupRes = await apiSignup({ email: user.email, password: user.password }).catch(
    async (err) => {
      if (err.status === 400 && err.message.includes('is already registered')) {
        return await apiSignin(user);
      }
      throw err;
    }
  );

  const cookie = signupRes.headers['set-cookie'];

  const newUserAxios = axiosInstance.create({
    ...signupRes.config,
    headers: {
      cookie,
    },
  });

  const axiosResponse = await newUserAxios.get(USER_ME);
  console.log('new user signed session', JSON.stringify(axiosResponse.data, null, 2));

  return newUserAxios;
}
