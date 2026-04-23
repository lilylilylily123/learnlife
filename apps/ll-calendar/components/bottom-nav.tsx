import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/constants/theme";

export type ActiveTab = "home" | "calendar" | "inbox";

const TABS: {
  id: ActiveTab;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  route: string;
  notifDot?: boolean;
}[] = [
  { id: "home", icon: "home", label: "Home", route: "/(tabs)/" },
  {
    id: "calendar",
    icon: "calendar-month",
    label: "Calendar",
    route: "/(tabs)/calendar",
  },
  {
    id: "inbox",
    icon: "chat-bubble-outline",
    label: "Inbox",
    route: "/(tabs)/inbox",
    notifDot: true,
  },
];

export function BottomNav({ active }: { active: ActiveTab }) {
  return (
    <View style={s.bar}>
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Pressable
            key={tab.id}
            style={s.item}
            onPress={() => {
              if (!isActive) router.replace(tab.route as any);
            }}
          >
            {isActive && <View style={s.indicator} />}
            <View style={s.iconWrap}>
              <MaterialIcons
                name={tab.icon}
                size={22}
                color={isActive ? Colors.textPrimary : Colors.muted}
              />
              {tab.notifDot && !isActive && <View style={s.notifDot} />}
            </View>
            <Text style={isActive ? s.labelActive : s.label}>
              {tab.label.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderTopWidth: 1.5,
    borderTopColor: Colors.textPrimary,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 0,
    paddingBottom: 14,
    paddingTop: 10,
    position: "absolute",
    right: 0,
  },
  item: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    position: "relative",
    paddingVertical: 2,
  },
  indicator: {
    backgroundColor: Colors.textPrimary,
    height: 2,
    position: "absolute",
    top: -10,
    width: 30,
  },
  iconWrap: {
    position: "relative",
  },
  notifDot: {
    backgroundColor: Colors.orange,
    borderColor: Colors.surface,
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: -3,
    top: -3,
    width: 10,
  },
  labelActive: {
    color: Colors.textPrimary,
    fontSize: 9.5,
    fontWeight: "700",
    fontFamily: Fonts.mono,
    letterSpacing: 0.8,
  },
  label: {
    color: Colors.muted,
    fontSize: 9.5,
    fontWeight: "600",
    fontFamily: Fonts.mono,
    letterSpacing: 0.8,
  },
});
