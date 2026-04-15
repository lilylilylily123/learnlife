import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type ActiveTab = "home" | "calendar" | "inbox";

const TABS: {
  id: ActiveTab;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  route: string;
  notifDot?: boolean;
}[] = [
  { id: "home", icon: "home", label: "Home", route: "/(tabs)/" },
  { id: "calendar", icon: "calendar-month", label: "Calendar", route: "/(tabs)/calendar" },
  { id: "inbox", icon: "chat-bubble", label: "Inbox", route: "/(tabs)/inbox", notifDot: true },
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
                size={24}
                color={isActive ? "#2D1B4E" : "#8A7E9E"}
              />
              {tab.notifDot && !isActive && <View style={s.notifDot} />}
            </View>
            <Text style={isActive ? s.labelActive : s.label}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    bottom: 0,
    elevation: 5,
    flexDirection: "row",
    justifyContent: "space-around",
    left: 0,
    paddingBottom: 14,
    paddingTop: 10,
    position: "absolute",
    right: 0,
    shadowColor: "#2D1B4E",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
  },
  item: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    position: "relative",
  },
  indicator: {
    backgroundColor: "#C4F34A",
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    height: 4,
    position: "absolute",
    top: -14,
    width: 44,
  },
  iconWrap: {
    position: "relative",
  },
  notifDot: {
    backgroundColor: "#FF6B35",
    borderColor: "#FFFFFF",
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: -2,
    top: -2,
    width: 10,
  },
  labelActive: {
    color: "#2D1B4E",
    fontSize: 12,
    fontWeight: "700",
  },
  label: {
    color: "#8A7E9E",
    fontSize: 12,
    fontWeight: "600",
  },
});
