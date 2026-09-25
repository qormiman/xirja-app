/**
 * Xirja -- "My list", "Browse", "Compare", "Store lists", "Item detail",
 * and "Shopping mode".
 *
 * Six real screens now, on REAL navigation (React Navigation) as of this
 * version -- previously a hand-rolled `screen` string in local state, which
 * worked fine for the first few screens but was starting to strain once
 * Compare -> Store lists -> Shopping mode became a three-deep chain. Now: a
 * root-level stack holds one "Tabs" screen (the actual three-tab bar --
 * "My list", "Browse", "Compare") plus "Item detail", "Store lists" and
 * "Shopping mode" as separate screens on that SAME root stack, pushed on
 * top of "Tabs" rather than nested inside a tab's own stack. That gives
 * real push/back navigation (including the hardware back button on
 * Android) and means the tab bar is simply absent on those pushed screens
 * -- there's no dynamic "hide the tab bar on this route" logic to get
 * wrong, because the tab bar only exists on the "Tabs" screen at all. (An
 * earlier version of this file nested the sub-screens inside each tab's
 * own stack and hid the tab bar by matching the focused nested-route name
 * -- that had a real bug where Store lists <-> Shopping mode worked but
 * there was no way back out to the tabs; see the comment above
 * `TabsScreen` near the bottom for the fix.)
 *
 * Still NOT in this app (comes later): the price-correction workflow, the
 * other 3 designed screens (Trip summary, Settings, Onboarding),
 * persisting Shopping mode's checked-off state past an app reload
 * (currently in-memory only, see ShoppingScreen's comment), and a real
 * login (see DEVICE_ID_STORAGE_KEY below).
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

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

function ListRow({ item, onInc, onDec, onRemove, onOpenDetail, busy }) {
  const { cheapest } = item;
  return (
    <View style={styles.row}>
      <View
        style={[
          styles.ribbon,
          { backgroundColor: cheapest ? cheapest.color : "rgba(22,23,26,.14)" },
        ]}
      />
      <Pressable style={styles.rowMain} onPress={() => onOpenDetail(item)}>
        <Text style={styles.itemName}>{item.category}</Text>
        {cheapest ? (
          <Text style={styles.itemSub}>
            {cheapest.store_name}
            {item.by_store.length > 1 ? ` · ${item.by_store.length} stores` : ""} · details
          </Text>
        ) : (
          <Text style={styles.itemSubMuted}>no price found right now · details</Text>
        )}
      </Pressable>
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
  onOpenDetail,
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
              onOpenDetail={onOpenDetail}
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
// "Item detail" screen
// ============================================================================
//
// Tapping any item on "My list" opens this. The current-price half (the
// "Cheapest right now" card and the full "All stores" breakdown) reuses
// data the list screen already has -- item.cheapest / item.by_store, from
// GET /lists/{user_id} -- no extra fetch needed for that part. The history
// half is new: GET /categories/{category}/history is the first endpoint in
// this app that looks further back than "the single latest price," so it's
// fetched fresh each time this screen opens for a given item.

function weekLabel(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function computeTrend(weeks) {
  if (weeks.length < 2) return null;
  const first = weeks[0].price;
  const last = weeks[weeks.length - 1].price;
  if (first === 0) return null;
  const pctChange = ((last - first) / first) * 100;
  if (Math.abs(pctChange) < 1) {
    return `Roughly flat since ${weekLabel(weeks[0].week_start)}.`;
  }
  const direction = pctChange > 0 ? "up" : "down";
  return `Price is ${direction} ${Math.abs(pctChange).toFixed(0)}% since ${weekLabel(weeks[0].week_start)}.`;
}

function HistoryBars({ weeks }) {
  if (weeks.length === 0) {
    return <Text style={styles.itemSubMuted}>No history yet for this store.</Text>;
  }
  const prices = weeks.map((w) => w.price);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const range = maxPrice - minPrice || maxPrice || 1;

  return (
    <View style={styles.historyBarsRow}>
      {weeks.map((w, i) => {
        // Every bar stays at least partly visible (18% floor) even for the
        // very lowest week -- an empty-looking bar reads as "no data",
        // which would be misleading when there IS a real price, it's just
        // the cheapest one in this stretch.
        const heightPct = 18 + ((w.price - minPrice) / range) * 82;
        const isLast = i === weeks.length - 1;
        return (
          <View key={w.week_start} style={styles.historyBarCol}>
            <Text style={styles.historyBarPrice}>{eur(w.price)}</Text>
            <View style={styles.historyBarTrack}>
              <View
                style={[
                  styles.historyBarFill,
                  { height: `${heightPct}%` },
                  isLast && styles.historyBarFillLast,
                ]}
              />
            </View>
            <Text style={styles.historyBarLabel}>{weekLabel(w.week_start)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ItemDetailScreen({ item, onBack }) {
  const [history, setHistory] = useState(null); // null while the first load is in flight
  const [historyError, setHistoryError] = useState(null);
  const [selectedStoreId, setSelectedStoreId] = useState(
    item.cheapest ? item.cheapest.store_id : null
  );

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryError(null);
    fetchJson(`/categories/${encodeURIComponent(item.category)}/history`)
      .then((result) => {
        if (cancelled) return;
        setHistory(result.stores);
        if (result.stores.length > 0 && !result.stores.some((s) => s.store_id === selectedStoreId)) {
          setSelectedStoreId(result.stores[0].store_id);
        }
      })
      .catch((err) => {
        if (!cancelled) setHistoryError(err.message || "Couldn't load price history");
      });
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on the category alone -- re-fetching if the user
    // just clicks a different store chip below would be pointless, the
    // whole history response already contains every store at once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.category]);

  const selectedStoreHistory = history
    ? history.find((s) => s.store_id === selectedStoreId)
    : null;
  const trendText = selectedStoreHistory ? computeTrend(selectedStoreHistory.weeks) : null;

  return (
    <View style={styles.screen}>
      <View style={styles.subHeader}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
        <View style={styles.subHeaderText}>
          <Text style={styles.title}>{item.category}</Text>
          <Text style={styles.subtitle}>
            {item.by_store.length} store{item.by_store.length === 1 ? "" : "s"} carry this right now
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.listContent}>
        {item.cheapest ? (
          <View style={styles.detailBestCard}>
            <Text style={styles.detailBestLabel}>Cheapest right now</Text>
            <Text style={styles.detailBestPrice}>{eur(item.cheapest.price)}</Text>
            <Text style={styles.detailBestStore}>{item.cheapest.store_name}</Text>
          </View>
        ) : (
          <View style={styles.detailBestCard}>
            <Text style={styles.itemSubMuted}>No price found anywhere right now.</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>All stores</Text>
        {item.by_store.map((offer) => (
          <View key={offer.store_id} style={styles.detailOfferRow}>
            <View style={[styles.detailOfferChip, { backgroundColor: offer.color }]}>
              <Text style={styles.detailOfferChipText}>{offer.short_code}</Text>
            </View>
            <Text style={styles.detailOfferName}>{offer.store_name}</Text>
            <Text style={styles.detailOfferPrice}>{eur(offer.price)}</Text>
          </View>
        ))}

        <Text style={styles.sectionLabel}>8-week price history</Text>
        {historyError ? (
          <Text style={styles.errorBannerText}>{historyError}</Text>
        ) : history === null ? (
          <View style={styles.centerFillSmall}>
            <ActivityIndicator />
          </View>
        ) : history.length === 0 ? (
          <Text style={styles.itemSubMuted}>No price history recorded yet for this category.</Text>
        ) : (
          <View style={styles.historyCard}>
            <View style={styles.historyChipsRow}>
              {history.map((s) => {
                const active = s.store_id === selectedStoreId;
                return (
                  <Pressable
                    key={s.store_id}
                    onPress={() => setSelectedStoreId(s.store_id)}
                    style={[
                      styles.historyChip,
                      { borderColor: s.color },
                      active && { backgroundColor: s.color },
                    ]}
                  >
                    <Text style={[styles.historyChipText, active && styles.historyChipTextActive]}>
                      {s.short_code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {selectedStoreHistory && <HistoryBars weeks={selectedStoreHistory.weeks} />}
            {trendText && <Text style={styles.historyTrend}>{trendText}</Text>}
          </View>
        )}
      </ScrollView>
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

function CompareScreen({ items, stores, loading, refreshing, onRefresh, onSplit }) {
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
        <ScrollView
          contentContainerStyle={styles.centerFill}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Text style={styles.emptyText}>
            Compare needs at least one item on "My list" to work out a real total per store.
          </Text>
        </ScrollView>
      </View>
    );
  }

  if (stores.length === 0) {
    // Not the same as "no items" -- this means /stores itself hasn't
    // loaded (still in flight, or its own fetch failed and the error
    // banner on another tab already said so). Wrapped in a real
    // pull-to-refresh (not just text telling you to) so there's an actual
    // way to retry from here, same as every other screen.
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.title}>Compare</Text>
          <Text style={styles.subtitle}>Couldn't load the store list</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.centerFill}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <Text style={styles.emptyText}>Pull down to refresh and try again.</Text>
        </ScrollView>
      </View>
    );
  }

  const ranked = computeStoreRanking(items, stores);
  const maxComparable = ranked.length ? ranked[ranked.length - 1].comparable : 1;
  const cheapest = ranked[0];
  const mostExpensive = ranked[ranked.length - 1];
  const wouldSave = mostExpensive.comparable - cheapest.comparable;
  const splitStopCount = computeStoreLists(items).groups.length;

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

      {splitStopCount > 1 && (
        <View style={styles.bottomBarWrap}>
          <Pressable onPress={onSplit} style={styles.bottomBarButton}>
            <Text style={styles.bottomBarButtonText}>
              Split into {splitStopCount} store lists
            </Text>
            <Text style={styles.bottomBarArrow}>→</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ============================================================================
// "Store lists" screen
// ============================================================================
//
// Compare answers "what if I bought everything at ONE store" -- this
// answers the other real question: if you're willing to make more than one
// stop, buying each item wherever it's individually cheapest, what does
// each stop's list actually look like? Same underlying per-item data as
// Compare (`item.cheapest`, already resolved by the API) -- just grouped
// by store instead of ranked as whole-basket totals. Reached from
// Compare's "Split into N store lists" button, mirroring the original
// clickable prototype's own flow (that button led to this exact screen
// there too). Only offered when splitting would actually involve more
// than one store -- if everything's cheapest at the same single store,
// Compare's own ranking already tells you that and there's nothing to
// split.

function computeStoreLists(items) {
  const byStore = {};
  let unpriced = 0;

  items.forEach((item) => {
    if (!item.cheapest) {
      unpriced += 1;
      return; // nothing anywhere has a price for this right now -- it
               // can't be assigned to any store's list.
    }
    const store = item.cheapest;
    const lineTotal = store.price * item.quantity;
    if (!byStore[store.store_id]) {
      byStore[store.store_id] = {
        storeId: store.store_id,
        name: store.store_name,
        shortCode: store.short_code,
        color: store.color,
        items: [],
        total: 0,
      };
    }
    byStore[store.store_id].items.push({ ...item, lineTotal });
    byStore[store.store_id].total += lineTotal;
  });

  const groups = Object.values(byStore).sort((a, b) => b.total - a.total);
  const maxTotal = groups.reduce((m, g) => Math.max(m, g.total), 0);
  return { groups, maxTotal, unpriced };
}

function StoreListCard({ group, maxTotal, checkedCount, onOpen }) {
  const preview = group.items.map((it) => it.category).join(", ");
  const allChecked = checkedCount >= group.items.length;
  return (
    <Pressable style={styles.storeListCard} onPress={onOpen}>
      <View style={styles.storeListTop}>
        <View style={[styles.storeListChip, { backgroundColor: group.color }]}>
          <Text style={styles.storeListChipText}>{group.shortCode}</Text>
        </View>
        <View style={styles.storeListMain}>
          <Text style={styles.storeListName}>{group.name}</Text>
          <Text style={styles.storeListMeta}>
            {allChecked
              ? "All done ✓"
              : checkedCount > 0
              ? `${checkedCount} of ${group.items.length} checked`
              : `${group.items.length} item${group.items.length === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Text style={styles.storeListTotal}>{eur(group.total)}</Text>
      </View>
      <View style={styles.compareBarTrack}>
        <View
          style={[
            styles.compareBarFill,
            {
              width: `${maxTotal > 0 ? Math.max(6, (group.total / maxTotal) * 100) : 6}%`,
              backgroundColor: group.color,
            },
          ]}
        />
      </View>
      <Text style={styles.storeListPreview} numberOfLines={2}>
        {preview}
      </Text>
      <Text style={styles.storeListOpenHint}>
        {allChecked ? "Tap to review" : "Tap to start shopping here →"}
      </Text>
    </Pressable>
  );
}

function StoreListsScreen({ items, checkedItemIds, onBack, onOpenShopping }) {
  const { groups, maxTotal, unpriced } = useMemo(() => computeStoreLists(items), [items]);

  return (
    <View style={styles.screen}>
      <View style={styles.subHeader}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
        <View style={styles.subHeaderText}>
          <Text style={styles.title}>Store lists</Text>
          <Text style={styles.subtitle}>
            {groups.length} stop{groups.length === 1 ? "" : "s"} · each item at its own cheapest store
          </Text>
        </View>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.storeId}
        contentContainerStyle={styles.listContent}
        renderItem={({ item: group }) => (
          <StoreListCard
            group={group}
            maxTotal={maxTotal}
            checkedCount={group.items.filter((it) => checkedItemIds.has(it.item_id)).length}
            onOpen={() => onOpenShopping(group.storeId)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Nothing to split yet -- add items with a real price first.</Text>
        }
        ListFooterComponent={
          unpriced > 0 ? (
            <Text style={styles.storeListFootnote}>
              {unpriced} item{unpriced === 1 ? "" : "s"} on your list currently{" "}
              {unpriced === 1 ? "has" : "have"} no price anywhere, so{" "}
              {unpriced === 1 ? "it isn't" : "they aren't"} in any list below.
            </Text>
          ) : null
        }
      />
    </View>
  );
}

// ============================================================================
// "Shopping mode" screen
// ============================================================================
//
// Reached by tapping a store card on Store lists -- a real checklist for
// that one stop: tick items off as they land in the trolley, watch the
// running total update, and jump straight to the next unfinished store
// without detouring back through Store lists first. Checked-off state
// lives only in memory for now (see `checkedItemIds` in App()) -- it
// resets if the app reloads mid-trip. That's a real, known gap (see
// PROGRESS.md), not an oversight: persisting it (AsyncStorage, keyed by
// list_id) is a small enough follow-up that it wasn't worth blocking this
// screen on. Deliberately no barcode scanning and no "fix this price" /
// "swap store" actions here, unlike the original prototype -- those need
// a camera and the price-correction workflow respectively, neither of
// which exist yet (see PROGRESS.md's "Not started" section).

function ShoppingRow({ item, checked, onToggle }) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.shoppingRow, checked && styles.shoppingRowChecked]}
    >
      <View style={[styles.shoppingCheckbox, checked && styles.shoppingCheckboxChecked]}>
        {checked && <Text style={styles.shoppingCheckMark}>✓</Text>}
      </View>
      <View style={styles.rowMain}>
        <Text style={[styles.itemName, checked && styles.shoppingTextChecked]}>
          {item.category}
        </Text>
        <Text style={[styles.itemSubMuted, checked && styles.shoppingTextChecked]}>
          Qty {item.quantity}
        </Text>
      </View>
      <Text style={[styles.price, checked && styles.shoppingTextChecked]}>{eur(item.lineTotal)}</Text>
    </Pressable>
  );
}

function ShoppingScreen({ items, checkedItemIds, onToggleItem, storeId, onSwitchStore, onBack }) {
  const { groups } = useMemo(() => computeStoreLists(items), [items]);
  const group = groups.find((g) => g.storeId === storeId);

  if (!group) {
    // The store this shopping trip was for no longer has any items
    // assigned to it (removed, or its cheapest store changed since) --
    // nothing left to shop here, so give a way back rather than an empty
    // screen with no exit.
    return (
      <View style={styles.screen}>
        <View style={styles.subHeader}>
          <Pressable onPress={onBack} style={styles.backBtn}>
            <Text style={styles.backBtnText}>‹</Text>
          </Pressable>
          <View style={styles.subHeaderText}>
            <Text style={styles.title}>Shopping</Text>
            <Text style={styles.subtitle}>This store's list is empty now</Text>
          </View>
        </View>
        <Text style={styles.emptyText}>
          Everything that was here has moved or been removed -- back to Store lists to see what's left.
        </Text>
      </View>
    );
  }

  const checkedCount = group.items.filter((it) => checkedItemIds.has(it.item_id)).length;
  const totalCount = group.items.length;
  const pct = totalCount > 0 ? checkedCount / totalCount : 0;
  const spent = group.items
    .filter((it) => checkedItemIds.has(it.item_id))
    .reduce((sum, it) => sum + it.lineTotal, 0);

  const nextUnfinished = groups.find(
    (g) => g.storeId !== group.storeId && g.items.some((it) => !checkedItemIds.has(it.item_id))
  );

  return (
    <View style={styles.screen}>
      <View style={styles.subHeader}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹</Text>
        </Pressable>
        <View style={styles.subHeaderText}>
          <Text style={styles.title}>{group.name}</Text>
          <Text style={styles.subtitle}>
            {checkedCount} of {totalCount} checked · {eur(spent)} of {eur(group.total)}
          </Text>
        </View>
      </View>

      <View style={styles.shoppingProgressWrap}>
        <View style={styles.shoppingProgressTrack}>
          <View
            style={[
              styles.shoppingProgressFill,
              { flex: Math.max(pct, 0.04), backgroundColor: group.color },
            ]}
          />
          {pct < 1 && <View style={{ flex: 1 - pct }} />}
        </View>
      </View>

      {groups.length > 1 && (
        <View style={styles.shoppingSwitcherRow}>
          {groups.map((g) => {
            const active = g.storeId === group.storeId;
            const gDone = g.items.every((it) => checkedItemIds.has(it.item_id));
            return (
              <Pressable
                key={g.storeId}
                onPress={() => onSwitchStore(g.storeId)}
                style={[
                  styles.shoppingSwitcherChip,
                  { borderColor: g.color },
                  active && { backgroundColor: g.color },
                ]}
              >
                <Text
                  style={[
                    styles.shoppingSwitcherChipText,
                    active && styles.shoppingSwitcherChipTextActive,
                  ]}
                >
                  {g.shortCode}
                  {gDone ? " ✓" : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <FlatList
        data={group.items}
        keyExtractor={(it) => it.item_id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <ShoppingRow
            item={item}
            checked={checkedItemIds.has(item.item_id)}
            onToggle={() => onToggleItem(item.item_id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      <View style={styles.bottomBarWrap}>
        {nextUnfinished ? (
          <Pressable onPress={() => onSwitchStore(nextUnfinished.storeId)} style={styles.bottomBarButton}>
            <Text style={styles.bottomBarButtonText}>Next: {nextUnfinished.name}</Text>
            <Text style={styles.bottomBarArrow}>→</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onBack} style={styles.bottomBarButton}>
            <Text style={styles.bottomBarButtonText}>
              {checkedCount === totalCount ? "Done -- back to store lists" : "Back to store lists"}
            </Text>
            <Text style={styles.bottomBarArrow}>→</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// Navigation + top-level app
// ============================================================================
//
// Three real destinations sit on a bottom tab bar: "My list", "Browse",
// "Compare". "Item detail", "Store lists" and "Shopping mode" are NOT nested
// inside those tabs -- they're screens on one root-level stack that sits
// ABOVE the whole tab bar (the tab bar itself lives on a single "Tabs"
// screen, `TabsScreen` below). That's a deliberate fix, not the original
// design: an earlier version nested a small stack INSIDE the "My list" and
// "Compare" tabs and hid the tab bar dynamically (by matching the nested
// stack's currently-focused route name) whenever one of those pushed
// screens was open. That version had a real bug -- going Store lists <->
// Shopping mode worked, but there was no reliable way back out to the
// three main tabs, because the tab bar's visibility depended on correctly
// re-deriving the focused nested route on every render, which is fragile.
// Putting these screens on the ROOT stack instead removes that failure
// mode entirely: the tab bar physically doesn't exist outside the "Tabs"
// screen, so there's nothing to get stuck in a wrong state -- going back
// is always just one root-stack `goBack()` away from any of these screens,
// and it lands you back on whichever tab you left, exactly as it was.
// `navigation.navigate("StoreLists")` etc. called from inside a tab still
// works reaching a root-level screen -- React Navigation walks up the
// navigator tree to find a screen name that isn't in the current
// navigator, so no extra plumbing is needed at the call sites below.
//
// All the app's real state (the list, categories, stores, loading/busy
// flags, the in-memory checked-off set) lives in `App()`, same as before,
// and reaches every screen through `AppStateContext` rather than being
// passed down as navigator props. This is deliberate, not just a style
// choice: a `Tab.Screen`/`Stack.Screen`'s `component` must be a STABLE
// function reference, or React Navigation treats it as a brand new screen
// on every render and remounts it -- which, here, would mean getting
// kicked back to the top of a stack every time an item's quantity changed
// mid-navigation. Context lets these route components stay fixed,
// module-level functions while still always reading the latest state.

const AppStateContext = createContext(null);
const useAppState = () => useContext(AppStateContext);

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_BAR_STYLE = { backgroundColor: "#fcfcfb", borderTopColor: "#e1e0d9" };

function ListRoute({ navigation }) {
  const {
    items,
    categories,
    loading,
    refreshing,
    busyItemId,
    errorMessage,
    onRefresh,
    handleAdd,
    handleQuantityChange,
    handleRemove,
  } = useAppState();
  return (
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
      onOpenDetail={(item) => navigation.navigate("ItemDetail", { itemId: item.item_id })}
    />
  );
}

function ItemDetailRoute({ navigation, route }) {
  const { items } = useAppState();
  const item = items.find((it) => it.item_id === route.params.itemId);

  useEffect(() => {
    // Covers removing an item (or a refresh dropping it, e.g. it stopped
    // being priced anywhere) while its detail screen happens to be open --
    // rather than showing a detail screen for an item that no longer
    // exists, just go back to "My list".
    if (!item) navigation.goBack();
  }, [item, navigation]);

  if (!item) return null;
  return <ItemDetailScreen item={item} onBack={() => navigation.goBack()} />;
}

function BrowseRoute() {
  const { categories, items, loading, refreshing, onRefresh, handleAdd, busyCategory } = useAppState();
  return (
    <BrowseScreen
      categories={categories}
      items={items}
      loading={loading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onAdd={handleAdd}
      busyCategory={busyCategory}
    />
  );
}

function CompareRoute({ navigation }) {
  const { items, stores, loading, refreshing, onRefresh } = useAppState();
  return (
    <CompareScreen
      items={items}
      stores={stores}
      loading={loading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onSplit={() => navigation.navigate("StoreLists")}
    />
  );
}

function StoreListsRoute({ navigation }) {
  const { items, checkedItemIds } = useAppState();
  return (
    <StoreListsScreen
      items={items}
      checkedItemIds={checkedItemIds}
      onBack={() => navigation.goBack()}
      onOpenShopping={(storeId) => navigation.navigate("Shopping", { storeId })}
    />
  );
}

function ShoppingRoute({ navigation, route }) {
  const { items, checkedItemIds, handleToggleChecked } = useAppState();
  return (
    <ShoppingScreen
      items={items}
      checkedItemIds={checkedItemIds}
      onToggleItem={handleToggleChecked}
      storeId={route.params.storeId}
      onSwitchStore={(storeId) => navigation.setParams({ storeId })}
      // goBack(), not navigate("StoreLists") -- Shopping is always pushed
      // directly on top of Store lists on the root stack (see the comment
      // above), so popping one level is both simpler and exactly right,
      // the same way it is for every other back arrow in this file.
      onBack={() => navigation.goBack()}
    />
  );
}

// The screen that actually renders the three-tab bar. Kept as its own
// stable, module-level component (not inlined into App()'s return) for the
// same reason every *Route component above is -- registered as a
// `RootStack.Screen`'s `component`, not `children`.
function TabsScreen() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0ca30c",
        tabBarInactiveTintColor: "#898781",
        tabBarStyle: TAB_BAR_STYLE,
      }}
    >
      <Tab.Screen name="ListTab" component={ListRoute} options={{ tabBarLabel: "My list" }} />
      <Tab.Screen name="Browse" component={BrowseRoute} />
      <Tab.Screen name="CompareTab" component={CompareRoute} options={{ tabBarLabel: "Compare" }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [deviceId, setDeviceId] = useState(null);
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyItemId, setBusyItemId] = useState(null);
  const [busyCategory, setBusyCategory] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [checkedItemIds, setCheckedItemIds] = useState(() => new Set()); // in-memory only, see ShoppingScreen's comment

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

  function handleToggleChecked(itemId) {
    setCheckedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  const appState = {
    items,
    categories,
    stores,
    loading,
    refreshing,
    busyItemId,
    busyCategory,
    errorMessage,
    checkedItemIds,
    onRefresh,
    handleAdd,
    handleQuantityChange,
    handleRemove,
    handleToggleChecked,
  };

  return (
    // SafeAreaProvider has to be the outermost wrapper here -- React
    // Navigation's bottom tab bar reads its own bottom inset from
    // `react-native-safe-area-context` (via `useSafeAreaInsets`) to size
    // and pad itself correctly against the real device safe area. Without
    // a `SafeAreaProvider` ancestor that hook has nothing real to read and
    // falls back to bad defaults -- which is exactly what a tab bar that
    // looks "half cut off" at the bottom means. The plain `SafeAreaView`
    // from "react-native" below is unrelated -- it only pads its own
    // children away from a notch/status bar and doesn't provide this
    // context, which is why adding React Navigation without also adding
    // this provider left the bug in place.
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <AppStateContext.Provider value={appState}>
          <NavigationContainer>
            <RootStack.Navigator screenOptions={{ headerShown: false }}>
              <RootStack.Screen name="Tabs" component={TabsScreen} />
              <RootStack.Screen name="ItemDetail" component={ItemDetailRoute} />
              <RootStack.Screen name="StoreLists" component={StoreListsRoute} />
              <RootStack.Screen name="Shopping" component={ShoppingRoute} />
            </RootStack.Navigator>
          </NavigationContainer>
        </AppStateContext.Provider>
      </SafeAreaView>
    </SafeAreaProvider>
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

  compareSavingCard: {
    backgroundColor: "#0b0b0b",
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  compareSavingLabel: { fontSize: 11, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 },
  compareSavingValue: { fontSize: 30, fontWeight: "700", color: "#ffffff", marginTop: 6 },
  compareSavingNote: { fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginTop: 8, lineHeight: 17 },

  bottomBarWrap: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
    backgroundColor: "#fcfcfb",
    borderTopWidth: 1,
    borderTopColor: "#e1e0d9",
  },
  bottomBarButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#0ca30c",
  },
  bottomBarButtonText: { fontSize: 15, fontWeight: "600", color: "#ffffff" },
  bottomBarArrow: { fontSize: 16, fontWeight: "700", color: "#ffffff" },

  subHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  subHeaderText: { flex: 1, minWidth: 0 },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#f1f0ec",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtnText: { fontSize: 20, fontWeight: "600", color: "#0b0b0b", marginTop: -2 },

  storeListCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 16,
    padding: 15,
    marginBottom: 10,
  },
  storeListTop: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  storeListChip: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  storeListChipText: { fontSize: 12, fontWeight: "700", color: "#ffffff" },
  storeListMain: { flex: 1, minWidth: 0 },
  storeListName: { fontSize: 16, fontWeight: "600", color: "#0b0b0b" },
  storeListMeta: { fontSize: 11.5, color: "#898781", marginTop: 3 },
  storeListTotal: { fontSize: 16, fontWeight: "700", color: "#0b0b0b" },
  storeListPreview: { fontSize: 12, color: "#52514e", marginTop: 9, lineHeight: 17 },
  storeListOpenHint: { fontSize: 11.5, fontWeight: "600", color: "#0ca30c", marginTop: 10 },
  storeListFootnote: {
    fontSize: 11.5,
    color: "#898781",
    marginTop: 4,
    lineHeight: 16,
  },

  centerFillSmall: { paddingVertical: 24, alignItems: "center" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#898781",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 9,
  },

  detailBestCard: {
    backgroundColor: "#0b0b0b",
    borderRadius: 16,
    padding: 18,
    alignItems: "flex-start",
  },
  detailBestLabel: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  detailBestPrice: { fontSize: 32, fontWeight: "700", color: "#ffffff", marginTop: 8 },
  detailBestStore: { fontSize: 13, fontWeight: "500", color: "#60db89", marginTop: 6 },

  detailOfferRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  detailOfferChip: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },
  detailOfferChipText: { fontSize: 10, fontWeight: "700", color: "#ffffff" },
  detailOfferName: { flex: 1, fontSize: 14, fontWeight: "500", color: "#0b0b0b" },
  detailOfferPrice: { fontSize: 15, fontWeight: "700", color: "#0b0b0b" },

  historyCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 16,
    padding: 16,
  },
  historyChipsRow: { flexDirection: "row", gap: 7, marginBottom: 16, flexWrap: "wrap" },
  historyChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  historyChipText: { fontSize: 11.5, fontWeight: "700", color: "#0b0b0b" },
  historyChipTextActive: { color: "#ffffff" },

  historyBarsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 150,
  },
  historyBarCol: { flex: 1, alignItems: "center", height: "100%", justifyContent: "flex-end" },
  historyBarPrice: { fontSize: 9.5, color: "#898781", marginBottom: 4 },
  historyBarTrack: {
    width: 16,
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#f1f0ec",
    borderRadius: 4,
    overflow: "hidden",
  },
  historyBarFill: { width: "100%", backgroundColor: "rgba(11,11,11,0.28)", borderRadius: 4 },
  historyBarFillLast: { backgroundColor: "#0ca30c" },
  historyBarLabel: { fontSize: 9, color: "#898781", marginTop: 6 },
  historyTrend: {
    fontSize: 12,
    color: "#52514e",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#f1f0ec",
  },

  shoppingProgressWrap: { paddingHorizontal: 20, marginBottom: 4 },
  // Built as two flex-weighted children in a row, NOT a percentage
  // `width` string on a single child -- a percentage width here didn't
  // reliably reflow as `pct` changed on a screen that stays mounted while
  // you check items off (as opposed to Compare/Store lists, where the
  // whole row list re-renders fresh each time). flex-based proportions
  // recompute every render, which a cached percentage measurement
  // sometimes doesn't.
  shoppingProgressTrack: {
    flexDirection: "row",
    height: 9,
    borderRadius: 5,
    backgroundColor: "#f1f0ec",
    overflow: "hidden",
  },
  shoppingProgressFill: { borderRadius: 5 },

  shoppingSwitcherRow: {
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexWrap: "wrap",
  },
  shoppingSwitcherChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  shoppingSwitcherChipText: { fontSize: 11.5, fontWeight: "700", color: "#0b0b0b" },
  shoppingSwitcherChipTextActive: { color: "#ffffff" },

  shoppingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1e0d9",
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  shoppingRowChecked: { backgroundColor: "#f6f5f1", borderColor: "#e1e0d9" },
  shoppingCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#c9c7bf",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },
  shoppingCheckboxChecked: { backgroundColor: "#0ca30c", borderColor: "#0ca30c" },
  shoppingCheckMark: { fontSize: 13, fontWeight: "700", color: "#ffffff" },
  shoppingTextChecked: { color: "#a8a69f", textDecorationLine: "line-through" },

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
