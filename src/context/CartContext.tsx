"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { readStore, useStore, writeStore } from "@/lib/browserStore";

export interface CartItem {
  /** Product id. */
  id: string;
  /** Product slug, used to link back to the detail page. */
  slug: string;
  name: string;
  /** Category display name, shown as the small badge in the cart. */
  category: string;
  price: number;
  image: string;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  /** Set when an item is added, so the drawer can highlight it. */
  lastAddedId: string | null;
  /** False until the persisted cart has been read on the client. */
  hydrated: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_KEY = "dhs.cart.v1";
/** Module-level so the snapshot reference stays stable across renders. */
const EMPTY_CART: CartItem[] = [];

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useStore<CartItem[]>(CART_KEY, EMPTY_CART);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);

  const addToCart = useCallback(
    (item: Omit<CartItem, "quantity">, quantity = 1) => {
      const current = readStore<CartItem[]>(CART_KEY, EMPTY_CART);
      const existing = current.find((i) => i.id === item.id);
      const next = existing
        ? current.map((i) =>
            i.id === item.id ? { ...i, quantity: i.quantity + quantity } : i
          )
        : [...current, { ...item, quantity }];
      setItems(next);
      setLastAddedId(item.id);
      setIsCartOpen(true);
    },
    [setItems]
  );

  const removeFromCart = useCallback(
    (id: string) => {
      const current = readStore<CartItem[]>(CART_KEY, EMPTY_CART);
      setItems(current.filter((i) => i.id !== id));
    },
    [setItems]
  );

  const updateQuantity = useCallback(
    (id: string, quantity: number) => {
      const current = readStore<CartItem[]>(CART_KEY, EMPTY_CART);
      if (quantity <= 0) {
        setItems(current.filter((i) => i.id !== id));
        return;
      }
      setItems(current.map((i) => (i.id === id ? { ...i, quantity } : i)));
    },
    [setItems]
  );

  const clearCart = useCallback(() => {
    writeStore(CART_KEY, EMPTY_CART);
  }, []);

  const { totalItems, totalPrice } = useMemo(
    () => ({
      totalItems: items.reduce((sum, i) => sum + i.quantity, 0),
      totalPrice: items.reduce((sum, i) => sum + i.price * i.quantity, 0),
    }),
    [items]
  );

  const value = useMemo(
    () => ({
      items,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      totalItems,
      totalPrice,
      isCartOpen,
      setIsCartOpen,
      lastAddedId,
      hydrated: true,
    }),
    [
      items,
      addToCart,
      removeFromCart,
      updateQuantity,
      clearCart,
      totalItems,
      totalPrice,
      isCartOpen,
      lastAddedId,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
