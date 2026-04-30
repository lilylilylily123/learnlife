// PocketBase realtime requires EventSource, which doesn't exist in React Native.
// Wrap the polyfill so every PB-initiated SSE connection gets a generous
// heartbeat timeout — the default (45s) trips constantly because PB's SSE
// pings aren't always frequent enough, producing noisy "Reconnecting" errors.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EventSourcePolyfill } = require("event-source-polyfill");
if (typeof globalThis.EventSource === "undefined") {
  class PatchedEventSource extends EventSourcePolyfill {
    constructor(url: string, opts: Record<string, unknown> = {}) {
      super(url, { heartbeatTimeout: 5 * 60 * 1000, ...opts });
    }
  }
  // @ts-expect-error — polyfilling a global
  globalThis.EventSource = PatchedEventSource;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LogBox } = require("react-native");
LogBox.ignoreLogs([
  /No activity within \d+ milliseconds/,
]);

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
            name="forgot-password"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/create-event"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/event-detail"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/event-roster"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/chat"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/manage-invites"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="(modals)/new-conversation"
            options={{ presentation: "modal", headerShown: false }}
          />
          <Stack.Screen
            name="settings"
            options={{ presentation: "modal", headerShown: false }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </AuthProvider>
  );
}
