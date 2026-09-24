/**
 * Xirja -- "My List" screen, first real end-to-end slice.
 *
 * What this proves: that a real phone screen can ask the real API for a
 * real price, and show it. It is deliberately NOT the finished "My List"
 * screen from the design prototype yet -- there's no adding/removing
 * items, no persistence, no swipe gestures. Those come once this one
 * piece (data flowing all the way from Postgres, through the API, onto a
 * screen) is confirmed working.
 *
 * The list of categories below is a fixed, hand-picked starter set --
 * replace CATEGORIES with whatever you want to see prices for. Once the
 * real "add an item to my list" feature exists (a later step -- it needs
 * the app_list / app_list_item tables wired up), this hardcoded list goes
 * away entirely.
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";

// ---------------------------------------------------------------------
// Already set to your real, deployed Render API -- this is the default
// going forward, so you shouldn't need to touch this most of the time.
//
// The one reason to CHANGE THIS: testing against the API running on your
// own computer instead (e.g. to try something before it's deployed).
// Requires your phone and computer on the same WiFi, and using your
// computer's LAN address, e.g. "http://192.168.1.23:8000" (NOT
// "localhost" -- your phone can't reach "localhost" meaning itself). Find
// your computer's LAN address in SETUP.md -> "Running the API locally,
// for quick testing". Switch this back to the Render address below
// afterwards.
// ---------------------------------------------------------------------
const API_BASE_URL = "https://xirja-backend.onrender.com";

const CATEGORIES = ["Milk", "Eggs", "Bread", "Olive Oil"];

/**
 * Fetches the cheapest current price for one category from the real API.
 * Returns a plain result object rather than throwing, so the list can show
 * a per-item error state instead of one failed item breaking the screen.
 */
async function fetchCheapest(category) {
  // fetch() has no built-in timeout -- left alone, a request that never
  // gets a response (e.g. the WiFi network silently drops it instead of
  // refusing it, which some networks do for security) just hangs forever,
  // showing a permanent loading spinner with no explanation. This forces
  // it to give up and report a clear error instead.
  //
  // 45 seconds, not something shorter, specifically because of Render's
  // free tier: it "sleeps" the API after 15 idle minutes, and the first
  // request after that can take 30-60 seconds just to wake it back up
  // (see SETUP.md). A shorter timeout would fail almost every cold start
  // before Render even finishes waking up -- found by hitting exactly
  // that with an earlier, too-aggressive 10-second version of this.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(
      `${API_BASE_URL}/categories/${encodeURIComponent(category)}/prices`,
      { signal: controller.signal }
    );
    if (response.status === 404) {
      return { category, status: "not_found" };
    }
    if (!response.ok) {
      return { category, status: "error", message: `Server said ${response.status}` };
    }
    const data = await response.json();
    return { category, status: "ok", cheapest: data.cheapest };
  } catch (err) {
    if (err.name === "AbortError") {
      return {
        category,
        status: "error",
        message: "Timed out -- try pulling to refresh (Render may be waking up)",
      };
    }
    // Almost always means API_BASE_URL is unreachable -- wrong address,
    // phone and computer not on the same WiFi, or the server isn't
    // running. See SETUP.md's troubleshooting section.
    return { category, status: "error", message: "Couldn't reach the API" };
  } finally {
    clearTimeout(timeoutId);
  }
}

function ListRow({ item }) {
  if (item.status === "loading") {
    return (
      <View style={styles.row}>
        <Text style={styles.itemName}>{item.category}</Text>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (item.status === "not_found") {
    return (
      <View style={styles.row}>
        <Text style={styles.itemName}>{item.category}</Text>
        <Text style={styles.muted}>no price found</Text>
      </View>
    );
  }

  if (item.status === "error") {
    return (
      <View style={styles.row}>
        <Text style={styles.itemName}>{item.category}</Text>
        <Text style={styles.errorText}>{item.message}</Text>
      </View>
    );
  }

  const { cheapest } = item;
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.itemName}>{item.category}</Text>
        <Text style={styles.productName} numberOfLines={1}>
          {cheapest.product_name} · {cheapest.store_name}
        </Text>
      </View>
      <Text style={styles.price}>&euro;{cheapest.price.toFixed(2)}</Text>
    </View>
  );
}

export default function App() {
  const [items, setItems] = useState(
    CATEGORIES.map((category) => ({ category, status: "loading" }))
  );
  const [refreshing, setRefreshing] = useState(false);

  async function loadPrices() {
    const results = await Promise.all(CATEGORIES.map(fetchCheapest));
    setItems(results);
  }

  useEffect(() => {
    loadPrices();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadPrices();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>My list</Text>
        <Text style={styles.subtitle}>Cheapest price right now, per item</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.category}
        renderItem={({ item }) => <ListRow item={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#fcfcfb",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0b0b0b",
  },
  subtitle: {
    fontSize: 13,
    color: "#52514e",
    marginTop: 2,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  rowLeft: {
    flexShrink: 1,
    paddingRight: 12,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "500",
    color: "#0b0b0b",
  },
  productName: {
    fontSize: 12.5,
    color: "#898781",
    marginTop: 2,
  },
  price: {
    fontSize: 17,
    fontWeight: "600",
    color: "#0b0b0b",
  },
  muted: {
    fontSize: 13,
    color: "#898781",
  },
  errorText: {
    fontSize: 12.5,
    color: "#d03b3b",
    maxWidth: 160,
    textAlign: "right",
  },
  separator: {
    height: 1,
    backgroundColor: "#e1e0d9",
  },
});
