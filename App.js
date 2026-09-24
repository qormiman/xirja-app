/**
 * Xirja -- "My list" screen, now genuinely usable.
 *
 * What changed from the first version: that one showed 4 hardcoded
 * categories with no way to add, remove, or change them -- it only proved
 * the phone-to-database connection worked. This version is a real list:
 * type to search a category (e.g. "Milk"), tap to add it, adjust quantity,
 * swipe-free remove button, pull to refresh. Every read and write goes
 * through the real API, backed by the real app_list / app_list_item
 * tables -- nothing here is stored only on the phone except which device
 * this is (see DEVICE_USER_ID below).
 *
 * Still NOT in this screen (comes later, once this is confirmed working):
 * navigation to the other 8 designed screens, the price-correction
 * workflow, and multi-store comparison/splitting -- this is still just
 * "My list" on its own.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------------------------------------------------------------------
// Already set to the real, deployed Render API -- shouldn't need to touch
// this most of the time.
//
// The one reason to CHANGE THIS: testing against the API running on your
// own computer instead. Requires your phone and computer on the same
// WiFi, and your computer's LAN address, e.g. "http://192.168.1.23:8000"
// (NOT "localhost" -- your phone can't reach "localhost" meaning itself).
// See ../SETUP.md in xirja-backend -> "Running the API locally". Switch
// this back to the Render address afterwards.
// ---------------------------------------------------------------------
const API_BASE_URL = "https://xirja-backend.onrender.com";

const REQUEST_TIMEOUT_MS = 45000; // see fetchJson()'s comment for why 45s

// ---------------------------------------------------------------------
// On DEVICE_USER_ID: there's no real login system yet -- accounts are a
// later step (see PROGRESS.md in xirja-backend). Until then, each phone
// generates one random id the first time this app opens and keeps it in
// AsyncStorage (survives closing the app; wiped if you reinstall it or
// clear app data). It's meaningless outside "which list is this
// device's" -- not an email, not a name, nothing personal.
// ---------------------------------------------------------------------
const DEVICE_ID_STORAGE_KEY = "xirja_device_user_id";

function makeDeviceId() {
  // Good enough to be practically unique for "one phone's list" -- not
  // trying to be cryptographically unguessable, since there's nothing
  // sensitive behind it (see the CORS comment in api/main.py).
  return "device_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

async function getDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const created = makeDeviceId();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
}

/**
 * Wraps fetch() with a timeout and consistent error shapes -- fetch() has
 * no built-in timeout, and left alone a request that never gets a
 * response (a WiFi network silently dropping it, or Render's free tier
 * waking up from sleep) shows a permanent spinner with no explanation
 * instead of a clear, recoverable error.
 */
async function fetchJson(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!response.ok) {
      let detail = `Server said ${response.status}`;
      try {
        const body = await response.json();
        if (body && body.detail) detail = body.detail;
      } catch (_e) {
        // response wasn't JSON -- keep the generic message above
      }
      throw new Error(detail);
    }
    return await response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Timed out -- try again (Render may be waking up)");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const eur = (n) => "€" + n.toFixed(2);

function AddItemBar({ categories, onAdd, disabled }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return categories
      .filter((c) => c.category.toLowerCase().includes(q))
      .slice(0, 5);
  }, [query, categories]);

  function pick(category) {
    onAdd(category);
    setQuery("");
    Keyboard.dismiss();
  }

  return (
    <View style={styles.addWrap}>
      <View style={styles.addInputRow}>
        <Text style={styles.addPlus}>+</Text>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Add an item… (e.g. Milk)"
          style={styles.addInput}
          editable={!disabled}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (suggestions.length > 0) pick(suggestions[0].category);
          }}
        />
      </View>
      {suggestions.length > 0 && (
        <View style={styles.suggestBox}>
          {suggestions.map((s) => (
            <Pressable
              key={s.category}
              onPress={() => pick(s.category)}
              style={({ pressed }) => [
                styles.suggestRow,
                pressed && styles.suggestRowPressed,
              ]}
            >
              <Text style={styles.suggestName}>{s.category}</Text>
              <Text style={styles.suggestHint}>{s.store_count} store{s.store_count === 1 ? "" : "s"}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ListRow({ item, onInc, onDec, onRemove, busy }) {
  const { cheapest } = item;
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.ribbon,
          { backgroundColor: cheapest ? cheapest.color : "rgba(22,23,26,.14)" },
        ]}
      />
      <View style={styles.rowMain}>
        <Text style={styles.itemName}>{item.category}</Text>
        {cheapest ? (
          <Text style={styles.itemSub}>
            {cheapest.store_name}
            {item.by_store.length > 1 ? ` · ${item.by_store.length} stores` : ""}
          </Text>
        ) : (
          <Text style={styles.itemSubMuted}>no price found right now</Text>
        )}
      </View>
      <View style={styles.priceCol}>
        <Text style={styles.price}>{cheapest ? eur(cheapest.price * item.quantity) : "—"}</Text>
        <View style={styles.qtyRow}>
          <Pressable onPress={() => onDec(item)} disabled={busy} style={styles.qtyBtn}>
            <Text style={styles.qtyBtnText}>−</Text>
          </Pressable>
          <Text style={styles.qtyValue}>{item.quantity}</Text>
          <Pressable onPress={() => onInc(item)} disabled={busy} style={styles.qtyBtn}>
            <Text style={styles.qtyBtnText}>+</Text>
          </Pressable>
        </View>
      </View>
      <Pressable onPress={() => onRemove(item)} disabled={busy} style={styles.removeBtn}>
        <Text style={styles.removeBtnText}>✕</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  const [deviceId, setDeviceId] = useState(null);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  async function loadEverything(id) {
    try {
      setErrorMessage(null);
      const [listResult, categoriesResult] = await Promise.all([
        fetchJson(`/lists/${id}`),
        fetchJson(`/categories`),
      ]);
      setItems(listResult.items);
      setCategories(categoriesResult.categories);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't reach the API");
    }
  }

  useEffect(() => {
    (async () => {
      const id = await getDeviceId();
      setDeviceId(id);
      await loadEverything(id);
      setLoading(false);
    })();
  }, []);

  async function onRefresh() {
    if (!deviceId) return;
    setRefreshing(true);
    await loadEverything(deviceId);
    setRefreshing(false);
  }

  async function handleAdd(category) {
    if (!deviceId) return;
    try {
      setErrorMessage(null);
      const result = await fetchJson(`/lists/${deviceId}/items`, {
        method: "POST",
        body: JSON.stringify({ category, quantity: 1 }),
      });
      setItems(result.items);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't add that item");
    }
  }

  async function handleQuantityChange(item, nextQuantity) {
    if (!deviceId) return;
    setBusyItemId(item.item_id);
    try {
      setErrorMessage(null);
      if (nextQuantity <= 0) {
        const result = await fetchJson(`/lists/${deviceId}/items/${item.item_id}`, {
          method: "DELETE",
        });
        setItems(result.items);
      } else {
        const result = await fetchJson(`/lists/${deviceId}/items/${item.item_id}`, {
          method: "PATCH",
          body: JSON.stringify({ quantity: nextQuantity }),
        });
        setItems(result.items);
      }
    } catch (err) {
      setErrorMessage(err.message || "Couldn't update that item");
    } finally {
      setBusyItemId(null);
    }
  }

  async function handleRemove(item) {
    if (!deviceId) return;
    setBusyItemId(item.item_id);
    try {
      setErrorMessage(null);
      const result = await fetchJson(`/lists/${deviceId}/items/${item.item_id}`, {
        method: "DELETE",
      });
      setItems(result.items);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't remove that item");
    } finally {
      setBusyItemId(null);
    }
  }

  const total = items.reduce(
    (sum, it) => sum + (it.cheapest ? it.cheapest.price * it.quantity : 0),
    0
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>My list</Text>
        <Text style={styles.subtitle}>
          {items.length} item{items.length === 1 ? "" : "s"} · {eur(total)} at cheapest prices
        </Text>
      </View>

      <AddItemBar categories={categories} onAdd={handleAdd} disabled={loading} />

      {errorMessage && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{errorMessage}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.item_id}
          renderItem={({ item }) => (
            <ListRow
              item={item}
              busy={busyItemId === item.item_id}
              onInc={(it) => handleQuantityChange(it, it.quantity + 1)}
              onDec={(it) => handleQuantityChange(it, it.quantity - 1)}
              onRemove={handleRemove}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nothing on the list yet -- add something above.</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fcfcfb" },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "600", color: "#0b0b0b" },
  subtitle: { fontSize: 13, color: "#52514e", marginTop: 2 },

  addWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  addInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addPlus: { fontSize: 16, fontWeight: "600", color: "#0ca30c" },
  addInput: { flex: 1, fontSize: 15, color: "#0b0b0b" },
  suggestBox: {
    marginTop: 6,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    overflow: "hidden",
  },
  suggestRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#f1f0ec",
  },
  suggestRowPressed: { backgroundColor: "#f6f5f1" },
  suggestName: { fontSize: 14, fontWeight: "500", color: "#0b0b0b" },
  suggestHint: { fontSize: 11, color: "#898781" },

  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 6,
    backgroundColor: "#fdecec",
    borderColor: "#f3c3c3",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorBannerText: { color: "#d03b3b", fontSize: 12.5 },

  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },

  listContent: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    paddingVertical: 12,
    paddingRight: 10,
    overflow: "hidden",
  },
  ribbon: { width: 5, alignSelf: "stretch", marginRight: 12 },
  rowMain: { flex: 1, minWidth: 0 },
  itemName: { fontSize: 15, fontWeight: "500", color: "#0b0b0b" },
  itemSub: { marginTop: 4, fontSize: 11.5, color: "#52514e" },
  itemSubMuted: { marginTop: 4, fontSize: 11.5, color: "#898781" },
  priceCol: { alignItems: "flex-end", marginRight: 8 },
  price: { fontSize: 15, fontWeight: "700", color: "#0b0b0b" },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  qtyBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "#f1f0ec",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyBtnText: { fontSize: 15, fontWeight: "600", color: "#0b0b0b" },
  qtyValue: { fontSize: 13, fontWeight: "600", color: "#0b0b0b", minWidth: 14, textAlign: "center" },
  removeBtn: { padding: 8 },
  removeBtnText: { fontSize: 14, color: "#898781" },

  separator: { height: 9 },
  emptyText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
    color: "#898781",
  },
});
