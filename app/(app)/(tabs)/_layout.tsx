import { Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, type ColorValue } from 'react-native';
import HamburgerMenu from '@/components/HamburgerMenu';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: '#3db56b',
        tabBarInactiveTintColor: '#8fb89a',
        tabBarLabelStyle: styles.tabLabel,
        headerStyle: styles.header,
        headerTitleStyle: styles.headerTitle,
        headerTintColor: '#fff',
        headerRight: () => <HamburgerMenu />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Rounds',
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <SymbolView name="house.fill" tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="play"
        options={{
          title: 'Play',
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <SymbolView name="plus.circle.fill" tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <SymbolView name="chart.bar.fill" tintColor={color} size={24} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }: { color: ColorValue }) => (
            <SymbolView name="list.bullet" tintColor={color} size={24} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: '#0f2419',
    borderTopColor: '#2d5a3d',
    borderTopWidth: 1,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  header: {
    backgroundColor: '#0f2419',
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '700',
  },
});
