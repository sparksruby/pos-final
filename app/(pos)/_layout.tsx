import { Redirect, Stack } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

export default function PosLayout() {
  const { user, isReady } = useAuthStore();

  if (!isReady) return null;
  if (!user) return <Redirect href="/(auth)/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
