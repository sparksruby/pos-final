import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

export default function AuthLayout() {
  const { user, isReady } = useAuthStore();

  if (!isReady) return null;
  if (user) return <Redirect href="/(pos)/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
