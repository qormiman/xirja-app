/**
 * Xirja -- "My list" + "Browse", the app's first bit of real navigation.
 *
 * What changed from the previous version: that one was "My list" alone,
 * where the only way to add something was typing its exact category name.
 * This adds a second real screen, Browse -- scroll every category that
 * currently has a real price behind it, tap + to add it -- and a simple
 * two-tab bar to switch between them. This is deliberately NOT the full
 * React Navigation library yet (no need for it with 2 screens) -- just
 * local state choosing which screen to show, the simplest thing that
 * works. Swapping in real navigation later, once there are more screens,
 * won't change how either screen's own logic works.
 *
 * Still NOT in this app (comes later): Compare (the multi-store
 * ranking/splitting logic), the price-correction workflow, the other 6
 * designed screens, and a real login (see DEVICE_ID_STORAGE_KEY below).
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
 *
 * Also retries ONCE, automatically, on a true network-level failure (the
 * browser's own "Failed to fetch" / "Network request failed" -- thrown
 * before any HTTP response comes back at all, as opposed to the server
 * responding with an error status). This specific failure is the classic
 * symptom of Render's free tier waking from sleep: the very first request
 * that reaches a sleeping service wakes it up but can itself get refused
 * or reset while the container is still starting, while a request a
 * second or two later succeeds normally. One retry, after a short pause,
 * covers exactly that window without masking a REAL, repeatable problem
 * (which would fail the retry too, and still surface as an error).
 */
async function fetchJsonOnce(path, options) {
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

function isNetworkLevelFailure(err) {
  // What the browser/React Native throw when a request never got a
  // response at all -- distinct from the server answering with a 4xx/5xx
  // (handled above) or our own explicit timeout message.
  const msg = (err && err.message) || "";
  return msg.includes("Failed to fetch") || msg.includes("Network request failed");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path, options = {}) {
  try {
    return await fetchJsonOnce(path, options);
  } catch (err) {
    if (!isNetworkLevelFailure(err)) throw err;
    await sleep(1500);
    return await fetchJsonOnce(path, options); // let a second failure throw normally
  }
}

const eur = (n) => "€" + n.toFixed(2);

// ============================================================================
// "My list" screen
// ============================================================================

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

function ListScreen({
  items,
  categories,
  loading,
  refreshing,
  busyItemId,
  errorMessage,
  onRefresh,
  onAdd,
  onInc,
  onDec,
  onRemove,
}) {
  const total = items.reduce(
    (sum, it) => sum + (it.cheapest ? it.cheapest.price * it.quantity : 0),
    0
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>My list</Text>
        <Text style={styles.subtitle}>
          {items.length} item{items.length === 1 ? "" : "s"} · {eur(total)} at cheapest prices
        </Text>
      </View>

      <AddItemBar categories={categories} onAdd={onAdd} disabled={loading} />

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
              onInc={(it) => onInc(it)}
              onDec={(it) => onDec(it)}
              onRemove={onRemove}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Nothing on the list yet -- add something above, or switch to Browse.</Text>
          }
        />
      )}
    </View>
  );
}

// ============================================================================
// "Browse" screen
// ============================================================================
//
// Scrolls every category that currently has a real price behind it (the
// same /categories the "My list" search box already uses), letting you
// tap + to add one without needing to know/type its exact name. Tapping +
// again just adds another one -- same "bump the quantity" behaviour as
// typing the same category twice in "My list".

function BrowseRow({ entry, inCartQuantity, onAdd, busy }) {
  const added = inCartQuantity > 0;
  return (
    <View style={styles.browseRow}>
      <View style={styles.rowMain}>
        <Text style={styles.itemName}>{entry.category}</Text>
        <Text style={styles.itemSubMuted}>
          {entry.store_count} store{entry.store_count === 1 ? "" : "s"} carry this right now
        </Text>
      </View>
      <Pressable
        onPress={() => onAdd(entry.category)}
        disabled={busy}
        style={[styles.browseAddBtn, added && styles.browseAddBtnActive]}
      >
        <Text style={[styles.browseAddBtnText, added && styles.browseAddBtnTextActive]}>
          {added ? `✓ ${inCartQuantity}` : "+ Add"}
        </Text>
      </Pressable>
    </View>
  );
}

function BrowseScreen({ categories, items, loading, refreshing, onRefresh, onAdd, busyCategory }) {
  const [query, setQuery] = useState("");

  const quantityByCategory = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      map[it.category] = it.quantity;
    });
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.category.toLowerCase().includes(q));
  }, [query, categories]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Browse</Text>
        <Text style={styles.subtitle}>
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} with a live price right now
        </Text>
      </View>

      <View style={styles.addWrap}>
        <View style={styles.addInputRow}>
          <Text style={styles.addPlus}>⌕</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter categories…"
            style={styles.addInput}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(entry) => entry.category}
          renderItem={({ item: entry }) => (
            <BrowseRow
              entry={entry}
              inCartQuantity={quantityByCategory[entry.category] || 0}
              onAdd={onAdd}
              busy={busyCategory === entry.category}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No categories match that search.</Text>
          }
        />
      )}
    </View>
  );
}

// ============================================================================
// "Compare" screen
// ============================================================================
//
// The app's core value: for each real store, "if everything on this list
// came from here, plus whatever it doesn't carry bought at whichever
// OTHER store is cheapest for that item, what's the real total?" -- ranked
// cheapest to most expensive. This is the same rule the original
// clickable prototype's storeTotal() used ("comparable" = what this store
// rings up + the cost of buying its gaps elsewhere), now computed from
// real data instead of a hardcoded 18-item catalog.
//
// Deliberately computed here on the phone, not as a new API endpoint:
// every number this needs (each item's price at every store that carries
// it, and its cheapest price anywhere) is already sitting in the `items`
// this screen is given -- see each item's `by_store` and `cheapest`
// fields, straight from GET /lists/{user_id}. Sending that same data to a
// new endpoint just to get a ranking back would be a round-trip for
// nothing; the actual list of real stores (GET /stores) is the one piece
// this couldn't derive on its own, since a store carrying zero of today's
// items wouldn't otherwise appear anywhere in the data at all.

function computeStoreRanking(items, stores) {
  return stores
    .map((store) => {
      let total = 0; // what this store itself rings up
      let elsewhere = 0; // cost of buying its gaps at their own cheapest store
      const missingNames = [];

      items.forEach((item) => {
        const offer = item.by_store.find((o) => o.store_id === store.store_id);
        if (offer) {
          total += offer.price * item.quantity;
        } else {
          missingNames.push(item.category);
          if (item.cheapest) {
            elsewhere += item.cheapest.price * item.quantity;
          }
          // an item with NO cheapest anywhere (out of stock everywhere)
          // simply can't be priced into any store's total -- same gap
          // for every store, so it doesn't change the ranking either way.
        }
      });

      return {
        ...store,
        total,
        elsewhere,
        comparable: total + elsewhere,
        missingCount: missingNames.length,
        missingNames,
      };
    })
    .sort((a, b) => a.comparable - b.comparable);
}

function CompareScreen({ items, stores, loading, refreshing, onRefresh }) {
  if (loading) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Compare</Text>
        </View>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Compare</Text>
          <Text style={styles.subtitle}>Add something to your list first</Text>
        </View>
        <Text style={styles.emptyText}>
          Compare needs at least one item on "My list" to work out a real total per store.
        </Text>
      </View>
    );
  }

  if (stores.length === 0) {
    // Not the same as "no items" -- this means /stores itself hasn't
    // loaded (still in flight, or its own fetch failed and the error
    // banner on another tab already says so). Showing this instead of
    // crashing on an empty ranking below.
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Compare</Text>
          <Text style={styles.subtitle}>Couldn't load the store list</Text>
        </View>
        <Text style={styles.emptyText}>Pull down to refresh and try again.</Text>
      </View>
    );
  }

  const ranked = computeStoreRanking(items, stores);
  const maxComparable = ranked.length ? ranked[ranked.length - 1].comparable : 1;
  const cheapest = ranked[0];
  const mostExpensive = ranked[ranked.length - 1];
  const wouldSave = mostExpensive.comparable - cheapest.comparable;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Compare</Text>
        <Text style={styles.subtitle}>
          {items.length} item{items.length === 1 ? "" : "s"} · whole basket, per store
        </Text>
      </View>

      <FlatList
        data={ranked}
        keyExtractor={(store) => store.store_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          wouldSave > 0 ? (
            <View style={styles.compareSavingCard}>
              <Text style={styles.compareSavingLabel}>Cheapest single store vs. most expensive</Text>
              <Text style={styles.compareSavingValue}>{eur(wouldSave)}</Text>
              <Text style={styles.compareSavingNote}>
                {cheapest.name} beats {mostExpensive.name} by this much for the exact same list.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: store, index }) => (
          <View style={styles.compareRow}>
            <View style={styles.compareRowTop}>
              <Text style={[styles.compareStoreName, index === 0 && styles.compareStoreNameBest]}>
                {index === 0 ? "★ " : ""}
                {store.name}
              </Text>
              <Text style={[styles.compareTotal, index === 0 && styles.compareStoreNameBest]}>
                {eur(store.comparable)}
              </Text>
            </View>
            <View style={styles.compareBarTrack}>
              <View
                style={[
                  styles.compareBarFill,
                  {
                    width: `${Math.max(6, (store.comparable / maxComparable) * 100)}%`,
                    backgroundColor: index === 0 ? store.color : "rgba(11,11,11,0.18)",
                  },
                ]}
              />
            </View>
            {store.missingCount > 0 && (
              <Text style={styles.compareNote}>
                {eur(store.total)} here + {eur(store.elsewhere)} for{" "}
                {store.missingCount === 1 ? store.missingNames[0] : `${store.missingCount} items`} elsewhere
              </Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

// ============================================================================
// Tab bar + top-level app
// ============================================================================

function TabBar({ screen, onChange }) {
  const tabs = [
    { key: "list", label: "My list" },
    { key: "browse", label: "Browse" },
    { key: "compare", label: "Compare" },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((t) => {
        const active = screen === t.key;
        return (
          <Pressable key={t.key} onPress={() => onChange(t.key)} style={styles.tabBtn}>
            <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{t.label}</Text>
            <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState("list");
  const [deviceId, setDeviceId] = useState(null);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);
  const [busyCategory, setBusyCategory] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  async function loadEverything(id) {
    // Deliberately NOT Promise.all -- these are two independent pieces of
    // data (the list, and the category picker), and one failing shouldn't
    // throw away the other's already-successful result. Each one reports
    // its own failure into the same banner; if both fail, the second
    // message simply overwrites the first, which is fine since fixing
    // either one (retrying) reloads both anyway.
    setErrorMessage(null);
    try {
      const listResult = await fetchJson(`/lists/${id}`);
      setItems(listResult.items);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't load your list");
    }
    try {
      const categoriesResult = await fetchJson(`/categories`);
      setCategories(categoriesResult.categories);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't load categories");
    }
    try {
      const storesResult = await fetchJson(`/stores`);
      setStores(storesResult.stores);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't load stores");
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
    setBusyCategory(category);
    try {
      setErrorMessage(null);
      const result = await fetchJson(`/lists/${deviceId}/items`, {
        method: "POST",
        body: JSON.stringify({ category, quantity: 1 }),
      });
      setItems(result.items);
    } catch (err) {
      setErrorMessage(err.message || "Couldn't add that item");
    } finally {
      setBusyCategory(null);
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      {screen === "list" ? (
        <ListScreen
          items={items}
          categories={categories}
          loading={loading}
          refreshing={refreshing}
          busyItemId={busyItemId}
          errorMessage={errorMessage}
          onRefresh={onRefresh}
          onAdd={handleAdd}
          onInc={(it) => handleQuantityChange(it, it.quantity + 1)}
          onDec={(it) => handleQuantityChange(it, it.quantity - 1)}
          onRemove={handleRemove}
        />
      ) : screen === "browse" ? (
        <BrowseScreen
          categories={categories}
          items={items}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onAdd={handleAdd}
          busyCategory={busyCategory}
        />
      ) : (
        <CompareScreen
          items={items}
          stores={stores}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}

      <TabBar screen={screen} onChange={setScreen} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fcfcfb" },
  screen: { flex: 1 },
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

  browseRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  browseAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#0b0b0b",
  },
  browseAddBtnActive: { backgroundColor: "#e7f6e7" },
  browseAddBtnText: { fontSize: 12.5, fontWeight: "600", color: "#ffffff" },
  browseAddBtnTextActive: { color: "#0ca30c" },

  separator: { height: 9 },
  emptyText: {
    textAlign: "center",
    marginTop: 40,
    fontSize: 14,
    color: "#898781",
  },

  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e1e0d9",
    backgroundColor: "#fcfcfb",
  },
  tabBtn: { flex: 1, alignItems: "center", paddingTop: 10, paddingBottom: 12 },
  tabBtnText: { fontSize: 13, fontWeight: "500", color: "#898781" },
  tabBtnTextActive: { color: "#0b0b0b", fontWeight: "600" },
  tabIndicator: { height: 3, width: 28, borderRadius: 2, marginTop: 8, backgroundColor: "transparent" },
  tabIndicatorActive: { backgroundColor: "#0ca30c" },

  compareSavingCard: {
    backgroundColor: "#0b0b0b",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  compareSavingLabel: { fontSize: 11, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 },
  compareSavingValue: { fontSize: 30, fontWeight: "700", color: "#ffffff", marginTop: 6 },
  compareSavingNote: { fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginTop: 8, lineHeight: 17 },

  compareRow: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    padding: 14,
    marginBottom: 9,
  },
  compareRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  compareStoreName: { fontSize: 14, fontWeight: "500", color: "#52514e" },
  compareStoreNameBest: { color: "#0b0b0b", fontWeight: "700" },
  compareTotal: { fontSize: 15, fontWeight: "600", color: "#52514e" },
  compareBarTrack: { height: 9, borderRadius: 5, backgroundColor: "#f1f0ec", overflow: "hidden", marginTop: 8 },
  compareBarFill: { height: "100%", borderRadius: 5 },
  compareNote: { fontSize: 11, color: "#898781", marginTop: 7 },
});
