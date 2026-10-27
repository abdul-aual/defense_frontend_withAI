
import { useEffect, useState } from "react";
import RentwiseChatbot from "./RentwiseChatbot";
import "./RentwiseChatbotWidget.css";

export default function RentwiseChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowGreeting(true);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, []);

  const openChat = () => {
    setIsOpen(true);
    setShowGreeting(false);
  };

  return (
    <div className="rentwise-chatbot-widget">
      {!isOpen && showGreeting && (
        <button
          type="button"
          className="rentwise-chatbot-greeting"
          onClick={openChat}
          aria-label="Open Rentwise virtual assistant"
        >
          <span className="greeting-close">×</span>

          <span className="greeting-icon">👋</span>

          <span className="greeting-text">
            <strong>Hi! I'm Rentwise Assistant</strong>
            <span>
              Need a ride? I can help you find the right vehicle. 🚗
            </span>
            <span className="greeting-action">
              Chat with us →
            </span>
          </span>
        </button>
      )}

<div
  className="rentwise-chatbot-window"
  style={{
    display: isOpen ? "flex" : "none",
  }}
>
  <button
    type="button"
    className="rentwise-chatbot-window-close"
    onClick={() => setIsOpen(false)}
    aria-label="Close chatbot"
    title="Close chat"
  >
    ×
  </button>

  <RentwiseChatbot />
</div>

      {!isOpen && (
        <button
          type="button"
          className="rentwise-chatbot-launcher"
          onClick={openChat}
          aria-label="Open Rentwise virtual assistant"
          title="Chat with Rentwise"
        >
          <span className="launcher-icon">✦</span>
          <span className="launcher-label">Ask Rentwise</span>
          <span className="launcher-status" />
        </button>
      )}
    </div>
  );
}
