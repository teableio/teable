import { SideMenu } from '@/features/main/components/SideMenu';

export default async function Page() {
  const fileTreeResp = await fetch(
    'http://localhost:3000/api/fileTree//Users/mayne/teable-workspaces/personal'
  );
  const fileTree = await fileTreeResp.json();
  console.log(fileTree);
  return <SideMenu />;
}
