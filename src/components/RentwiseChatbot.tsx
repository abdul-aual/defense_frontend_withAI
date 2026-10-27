import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import "./RentwiseChatbot.css";

interface Vehicle {
  id: number;
  vehicle_name: string;
  type: string;
  registration_number: string;
  ac_type: string;
  total_seats: number;
  fuel_type: string;
  suitcase_capacity: number;
  daily_rent_price: number | string;
  city: string;
  availability_status: string;
  image: string;
  created_at: string;
}

interface BookingContext {
  startDate: string;
  endDate: string;
  city?: string;
  passengers?: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  vehicles?: Vehicle[];
  bookingContext?: BookingContext;
  resultsMode?: "available" | "price";
}

interface ChatApiResponse {
  success: boolean;
  answer?: string;
  vehicles?: Vehicle[];
  bookingContext?: BookingContext;
  resultsMode?: "available" | "price";
  // Opaque to the browser: it is only sent back with the next message.
  conversationState?: unknown;
  message?: string;
}

interface SearchCriteria {
  vehicleType: string;
  city: string;
  startDate: string;
  endDate: string;
}

const API_URL = "http://localhost:5000/api/chat";
const REQUEST_TIMEOUT_MS = 40_000;

// Old versions saved the chat in sessionStorage. Those keys are removed on
// load so nothing from an earlier conversation can come back.
const LEGACY_STORAGE_KEYS = [
  "rentwise_chat_messages",
  "rentwise_previous_user_messages",
];

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  text: "Hi! Welcome to Rentwise. Tell me where you need a vehicle, how many passengers are travelling, and your pickup and return dates. I'll check live availability for you.",
};

const SUGGESTIONS = [
  "I want to rent a car",
  "Find available SUVs",
  "Show me the cheapest vehicles",
  "How does Rentwise work?",
];

/**
 * The conversation lives only in this module's memory (and React state).
 * - Moving between pages in the app keeps it, because the module stays loaded.
 * - Reloading the browser empties it, so every reload starts a fresh chat.
 * Nothing is written to localStorage, sessionStorage or IndexedDB.
 */
const session: {
  messages: ChatMessage[];
  conversationState: unknown;
} = {
  messages: [{ ...WELCOME_MESSAGE }],
  conversationState: undefined,
};

function resolveImage(image: string): string {
  return image.startsWith("http")
    ? image
    : `http://localhost:5000/${image.replace(/^\/+/, "")}`;
}

function countDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function searchPhrase(vehicle: Vehicle): string {
  if (vehicle.type === "SUV") return "an SUV";
  if (vehicle.type === "HiAce") return "a HiAce";
  return "a sedan";
}

export default function RentwiseChatbot() {
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(session.messages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [failedQuestion, setFailedQuestion] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const conversationStateRef = useRef<unknown>(session.conversationState);

  // Remove chat data written by older versions.
  useEffect(() => {
    try {
      LEGACY_STORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));
    } catch {
      // Storage may be unavailable; nothing to clean up then.
    }
  }, []);

  // Keep the in-memory session in step so route changes do not lose the chat.
  useEffect(() => {
    session.messages = messages;
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, error]);

  // Cancel any request still running when the chatbot unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Grow the textarea with its content (up to four lines).
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 110)}px`;
  }, [input]);

  const sendMessage = useCallback(
    async (rawQuestion: string, options?: { retry?: boolean }) => {
      const question = rawQuestion.trim();
      if (!question || loading) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);

      setInput("");
      setError("");
      setFailedQuestion("");
      setLoading(true);

      if (!options?.retry) {
        setMessages((current) => [...current, { role: "user", text: question }]);
      }

      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            conversationState: conversationStateRef.current,
          }),
          signal: controller.signal,
        });

        const data = (await response.json().catch(() => null)) as ChatApiResponse | null;

        // A newer request (or "New chat") replaced this one: ignore the reply.
        if (requestId !== requestIdRef.current) return;

        if (!response.ok || !data?.success || typeof data.answer !== "string" || !data.answer.trim()) {
          throw new Error(data?.message || "Rentwise sent an unexpected reply.");
        }

        conversationStateRef.current = data.conversationState;
        session.conversationState = data.conversationState;

        const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
        const assistantMessage: ChatMessage = { role: "assistant", text: data.answer.trim() };
        if (vehicles.length > 0) {
          assistantMessage.vehicles = vehicles;
          if (data.bookingContext) assistantMessage.bookingContext = data.bookingContext;
          if (data.resultsMode) assistantMessage.resultsMode = data.resultsMode;
        }

        // Only the newest answer keeps its vehicle cards, so old results
        // never sit under an unrelated reply.
        setMessages((current) => [
          ...current.map(
            (message): ChatMessage => ({ role: message.role, text: message.text }),
          ),
          assistantMessage,
        ]);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;

        const timedOut = controller.signal.aborted;
        const message = timedOut
          ? "Rentwise is taking too long to answer. Please try again."
          : err instanceof TypeError
            ? "I couldn't reach the Rentwise server. Please check your connection and try again."
            : err instanceof Error
              ? err.message
              : "Something went wrong. Please try again.";

        setError(message);
        setFailedQuestion(question);
      } finally {
        window.clearTimeout(timeout);
        if (requestId === requestIdRef.current) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [loading],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a new line. Ignore Enter used by an IME.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  function handleBook(vehicle: Vehicle, bookingContext?: BookingContext) {
    if (!bookingContext?.startDate || !bookingContext.endDate) {
      setError("Booking dates are missing. Please tell me your dates first.");
      return;
    }

    const searchCriteria: SearchCriteria = {
      vehicleType: vehicle.type,
      city: bookingContext.city || vehicle.city,
      startDate: bookingContext.startDate,
      endDate: bookingContext.endDate,
    };

    navigate(`/booking/${vehicle.id}`, {
      state: { vehicle, searchCriteria, pickupPoint: "" },
    });
  }

  function handleReset() {
    // Invalidate any request still in flight, then start from zero.
    requestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    conversationStateRef.current = undefined;
    session.conversationState = undefined;
    session.messages = [{ ...WELCOME_MESSAGE }];

    setMessages([{ ...WELCOME_MESSAGE }]);
    setInput("");
    setError("");
    setFailedQuestion("");
    setLoading(false);
    textareaRef.current?.focus();
  }

  const showSuggestions = messages.length === 1 && !loading;

  return (
    <section className="rentwise-chatbot" aria-label="Rentwise assistant">
      <header className="rentwise-chat-header">
        <div className="rentwise-chat-brand">
          <div className="rentwise-chat-logo">R</div>

          <div>
            <h2>Rentwise Assistant</h2>
            <p>
              <span className="rentwise-online-dot" />
              Vehicle rental support
            </p>
          </div>
        </div>

        <button type="button" className="rentwise-reset-button" onClick={handleReset}>
          New chat
        </button>
      </header>

      <div className="rentwise-chat-messages" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => (
          <div
            className={`rentwise-message-row ${message.role === "user" ? "user-row" : "assistant-row"}`}
            key={`${message.role}-${index}`}
          >
            {message.role === "assistant" && <div className="rentwise-avatar">R</div>}

            <div className="rentwise-message-content">
              <div
                className={`rentwise-message-bubble ${
                  message.role === "user" ? "user-bubble" : "assistant-bubble"
                }`}
              >
                {message.text}
              </div>

              {message.vehicles && message.vehicles.length > 0 && (
                <div className="rentwise-vehicle-results">
                  <h3>
                    {message.resultsMode === "price"
                      ? "Price comparison (dates not checked)"
                      : "Vehicles available for your dates"}
                  </h3>

                  {message.vehicles.map((vehicle) => {
                    const days = message.bookingContext
                      ? countDays(message.bookingContext.startDate, message.bookingContext.endDate)
                      : 0;
                    const total = days > 0 ? Number(vehicle.daily_rent_price) * days : 0;

                    return (
                      <article className="rentwise-vehicle-card" key={vehicle.id}>
                        {vehicle.image ? (
                          <img
                            className="rentwise-vehicle-image"
                            src={resolveImage(vehicle.image)}
                            alt={vehicle.vehicle_name}
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="rentwise-vehicle-image-placeholder">
                            Vehicle image unavailable
                          </div>
                        )}

                        <div className="rentwise-vehicle-details">
                          <div className="rentwise-vehicle-title-row">
                            <h4>{vehicle.vehicle_name}</h4>
                            <span className="rentwise-vehicle-type">{vehicle.type}</span>
                          </div>

                          <p className="rentwise-vehicle-city">{vehicle.city}</p>

                          <div className="rentwise-vehicle-specs">
                            <span>{vehicle.total_seats} seats</span>
                            <span>{vehicle.ac_type}</span>
                            <span>{vehicle.fuel_type}</span>
                            <span>{vehicle.suitcase_capacity} suitcases</span>
                          </div>

                          <div className="rentwise-vehicle-footer">
                            <div className="rentwise-vehicle-price">
                              <strong>
                                ৳{Number(vehicle.daily_rent_price).toLocaleString("en-BD")}
                              </strong>
                              <span>/ day</span>
                              {total > 0 && days > 1 && (
                                <span className="rentwise-vehicle-total">
                                  ৳{total.toLocaleString("en-BD")} for {days} days
                                </span>
                              )}
                            </div>

                            {message.bookingContext ? (
                              <button
                                type="button"
                                className="rentwise-book-button"
                                onClick={() => handleBook(vehicle, message.bookingContext)}
                              >
                                Book This
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="rentwise-book-button rentwise-check-button"
                                disabled={loading}
                                onClick={() =>
                                  void sendMessage(
                                    `I need ${searchPhrase(vehicle)} in ${vehicle.city}`,
                                  )
                                }
                              >
                                Check dates
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {showSuggestions && (
          <div className="rentwise-suggestions" aria-label="Suggested questions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                className="rentwise-suggestion-chip"
                onClick={() => void sendMessage(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="rentwise-message-row assistant-row">
            <div className="rentwise-avatar">R</div>

            <div className="rentwise-typing-indicator" role="status" aria-label="Rentwise is typing">
              <span className="rentwise-typing-dot" />
              <span className="rentwise-typing-dot" />
              <span className="rentwise-typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="rentwise-chat-error" role="alert">
          <span>{error}</span>
          {failedQuestion && (
            <button
              type="button"
              className="rentwise-retry-button"
              onClick={() => void sendMessage(failedQuestion, { retry: true })}
            >
              Try again
            </button>
          )}
        </div>
      )}

      <form className="rentwise-chat-form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about vehicles, city, dates..."
          aria-label="Your message"
          maxLength={1000}
        />

        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? "..." : "Send"}
        </button>
      </form>

      <p className="rentwise-chat-disclaimer">
        Press Enter to send, Shift+Enter for a new line. Availability is checked
        against current bookings and verified again when you submit a booking.
      </p>
    </section>
  );
}
