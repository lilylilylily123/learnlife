// PocketBase realtime requires EventSource, which doesn't exist in React Native
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EventSourcePolyfill } = require("event-source-polyfill");
if (typeof globalThis.EventSource === "undefined") {
  globalThis.EventSource = EventSourcePolyfill;
}

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { AuthProvider } from "../context/AuthContext";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <AuthProvider>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
          <Stack.Screen
            name="(modals)/create-event"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/event-detail"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/chat"
            options={{ presentation: "modal", headerShown: false }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
