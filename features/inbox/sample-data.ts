import type { Provider } from "@/generated/prisma/client";

/**
 * SAMPLE DATA — UI preview only.
 *
 * These conversations are fictional, live only in this file, and are
 * never read from or written to the database. Every surface that
 * renders them shows a "Sample preview" badge. Real conversations
 * arrive when the first channel adapter (Telegram) is connected.
 */

export type SampleConversationStatus = "OPEN" | "PENDING" | "RESOLVED";

export interface SampleMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  time: string;
  status?: "SENT" | "DELIVERED" | "READ";
}

export interface SamplePreviousInteraction {
  id: string;
  title: string;
  provider: Provider;
  timeLabel: string;
}

export interface SampleConversation {
  id: string;
  contactName: string;
  provider: Provider;
  snippet: string;
  timeLabel: string;
  unread: number;
  status: SampleConversationStatus;
  waiting: boolean;
  assigneeName: string | null;
  tags: string[];
  phone: string;
  email: string;
  location: string;
  customerSince: string;
  lastSeen: string;
  messages: SampleMessage[];
  previousInteractions: SamplePreviousInteraction[];
}

export const SAMPLE_TEAM_MEMBERS: readonly string[] = [
  "Anisha Sharma",
  "Rohan Karki",
  "Priya Singh",
  "Bibek Tamang",
];

function thread(
  prefix: string,
  rows: Array<["INBOUND" | "OUTBOUND", string, string, SampleMessage["status"]?]>,
): SampleMessage[] {
  return rows.map(([direction, body, time, status], index) => ({
    id: `${prefix}-m${index + 1}`,
    direction,
    body,
    time,
    ...(status ? { status } : {}),
  }));
}

export const SAMPLE_CONVERSATIONS: SampleConversation[] = [
  {
    id: "sc-1",
    contactName: "Michelle Carlson",
    provider: "WHATSAPP",
    snippet: "Hi, good morning. Sure, what is it about?",
    timeLabel: "08:31",
    unread: 2,
    status: "OPEN",
    waiting: true,
    assigneeName: "Anisha Sharma",
    tags: ["Sales", "Priority"],
    phone: "+1 415 555 0132",
    email: "michelle.carlson@example.com",
    location: "San Francisco, US",
    customerSince: "Jan 2025",
    lastSeen: "last seen recently",
    messages: thread("sc-1", [
      ["INBOUND", "Hi, good morning. Sure, what is it about?", "08:31"],
      [
        "OUTBOUND",
        "Our CRM helps your sales team manage leads, track customer interactions, and organize follow-ups in one system.",
        "08:31",
        "READ",
      ],
      ["INBOUND", "We already use spreadsheets for that. What's the difference?", "08:31"],
      ["INBOUND", "That sounds helpful. How does it improve sales results?", "08:31"],
      [
        "OUTBOUND",
        "That's a common situation 😊. With spreadsheets, data is manual and often hard to track — here everything updates itself.",
        "09:00",
        "READ",
      ],
      [
        "OUTBOUND",
        "Not at all 👍. It is user-friendly and customizable based on your business needs.",
        "09:00",
        "READ",
      ],
      ["INBOUND", "Great — can you send pricing for a team of 12?", "09:04"],
    ]),
    previousInteractions: [
      { id: "sc-1-p1", title: "Onboarding questions", provider: "WHATSAPP", timeLabel: "Jan 12" },
      {
        id: "sc-1-p2",
        title: "Trial extension request",
        provider: "FACEBOOK",
        timeLabel: "Dec 28",
      },
    ],
  },
  {
    id: "sc-2",
    contactName: "Sagar Thapa",
    provider: "WHATSAPP",
    snippet: "Namaste, mero order kahile deliver huncha?",
    timeLabel: "09:12",
    unread: 1,
    status: "OPEN",
    waiting: true,
    assigneeName: null,
    tags: ["Delivery"],
    phone: "+977 98510 22341",
    email: "sagar.thapa@example.com",
    location: "Pokhara, NP",
    customerSince: "Mar 2026",
    lastSeen: "online",
    messages: thread("sc-2", [
      ["INBOUND", "Namaste, mero order kahile deliver huncha?", "09:12"],
      ["INBOUND", "Order number chai #NP-8841 ho.", "09:12"],
      [
        "OUTBOUND",
        "Namaste Sagar ji! Let me check the delivery status for order #NP-8841 right away.",
        "09:15",
        "DELIVERED",
      ],
      ["INBOUND", "Hajur, dhanyabad. Bholi samma aaucha ta?", "09:16"],
    ]),
    previousInteractions: [
      { id: "sc-2-p1", title: "Payment via eSewa", provider: "WHATSAPP", timeLabel: "Feb 02" },
    ],
  },
  {
    id: "sc-3",
    contactName: "Robert Fox",
    provider: "WHATSAPP",
    snippet: "Hi, thanks. What's the main benefit over our current tool?",
    timeLabel: "Sun",
    unread: 0,
    status: "PENDING",
    waiting: false,
    assigneeName: "Rohan Karki",
    tags: ["Sales"],
    phone: "+44 7700 900123",
    email: "robert.fox@example.co.uk",
    location: "London, UK",
    customerSince: "Nov 2025",
    lastSeen: "last seen yesterday",
    messages: thread("sc-3", [
      ["INBOUND", "Hi, thanks. What's the main benefit over our current tool?", "Sun 10:02"],
      [
        "OUTBOUND",
        "The biggest win is one inbox for every channel — no tab-switching between apps.",
        "Sun 10:20",
        "READ",
      ],
      ["INBOUND", "Makes sense. I'll discuss with my team this week.", "Sun 10:24"],
    ]),
    previousInteractions: [],
  },
  {
    id: "sc-4",
    contactName: "Anjali Gurung",
    provider: "TELEGRAM",
    snippet: "Booking confirm bhayo? Hotel le reply gareko chaina.",
    timeLabel: "10:05",
    unread: 3,
    status: "OPEN",
    waiting: true,
    assigneeName: null,
    tags: ["Booking", "Urgent"],
    phone: "+977 98130 44782",
    email: "anjali.gurung@example.com",
    location: "Kathmandu, NP",
    customerSince: "Jun 2026",
    lastSeen: "online",
    messages: thread("sc-4", [
      ["INBOUND", "Hello, I booked the mountain view room for next Friday.", "09:58"],
      ["INBOUND", "Booking confirm bhayo? Hotel le reply gareko chaina.", "10:05"],
      ["INBOUND", "Please let me know today, I need to plan travel. 🙏", "10:05"],
    ]),
    previousInteractions: [
      {
        id: "sc-4-p1",
        title: "Room availability in March",
        provider: "TELEGRAM",
        timeLabel: "Feb 18",
      },
      { id: "sc-4-p2", title: "Airport pickup", provider: "WHATSAPP", timeLabel: "Jan 30" },
    ],
  },
  {
    id: "sc-5",
    contactName: "Guy Hawkins",
    provider: "WHATSAPP",
    snippet: "How does it work?",
    timeLabel: "Today",
    unread: 0,
    status: "OPEN",
    waiting: false,
    assigneeName: "Priya Singh",
    tags: ["Onboarding"],
    phone: "+61 412 555 908",
    email: "guy.hawkins@example.com.au",
    location: "Sydney, AU",
    customerSince: "Feb 2026",
    lastSeen: "last seen 1 hour ago",
    messages: thread("sc-5", [
      ["INBOUND", "How does it work?", "07:40"],
      [
        "OUTBOUND",
        "You connect your channels once, and every message lands in this single inbox.",
        "07:52",
        "READ",
      ],
      ["INBOUND", "And my team can all reply from the same place?", "07:55"],
    ]),
    previousInteractions: [],
  },
  {
    id: "sc-6",
    contactName: "Dianne Russell",
    provider: "TELEGRAM",
    snippet: "Hi, okay. What does your CRM include for reporting?",
    timeLabel: "Sat",
    unread: 0,
    status: "RESOLVED",
    waiting: false,
    assigneeName: "Bibek Tamang",
    tags: ["Reporting"],
    phone: "+1 646 555 0187",
    email: "dianne.russell@example.com",
    location: "New York, US",
    customerSince: "Aug 2025",
    lastSeen: "last seen Saturday",
    messages: thread("sc-6", [
      ["INBOUND", "Hi, okay. What does your CRM include for reporting?", "Sat 09:14"],
      [
        "OUTBOUND",
        "Volume by channel, first-response time and resolution rate — all exportable.",
        "Sat 09:31",
        "READ",
      ],
      ["INBOUND", "Perfect, that's what we needed. Thank you!", "Sat 09:33"],
    ]),
    previousInteractions: [
      { id: "sc-6-p1", title: "Invoice copy request", provider: "TELEGRAM", timeLabel: "Jan 09" },
    ],
  },
  {
    id: "sc-7",
    contactName: "Prakash Shrestha",
    provider: "FACEBOOK",
    snippet: "Yo shoe ko 42 size available cha?",
    timeLabel: "11:20",
    unread: 1,
    status: "OPEN",
    waiting: true,
    assigneeName: null,
    tags: ["Stock"],
    phone: "+977 98412 90876",
    email: "prakash.shrestha@example.com",
    location: "Lalitpur, NP",
    customerSince: "Apr 2026",
    lastSeen: "active now",
    messages: thread("sc-7", [
      ["INBOUND", "Namaste, yo shoe ko photo pathauna milcha?", "11:02"],
      ["INBOUND", "Yo shoe ko 42 size available cha?", "11:20"],
      ["INBOUND", "Price kati ho ra delivery kati din lagcha?", "11:20"],
    ]),
    previousInteractions: [],
  },
  {
    id: "sc-8",
    contactName: "Theresa Webb",
    provider: "TELEGRAM",
    snippet: "We're having issues with missed notifications since yesterday.",
    timeLabel: "Sat",
    unread: 0,
    status: "PENDING",
    waiting: false,
    assigneeName: "Anisha Sharma",
    tags: ["Support", "Bug"],
    phone: "+1 312 555 0143",
    email: "theresa.webb@example.com",
    location: "Chicago, US",
    customerSince: "Oct 2025",
    lastSeen: "last seen Saturday",
    messages: thread("sc-8", [
      ["INBOUND", "We're having issues with missed notifications since yesterday.", "Sat 15:44"],
      [
        "OUTBOUND",
        "Sorry about that, Theresa. Our team is checking the notification service now.",
        "Sat 16:02",
        "READ",
      ],
      ["INBOUND", "Thanks — it affects about 20 of our agents.", "Sat 16:05"],
    ]),
    previousInteractions: [
      { id: "sc-8-p1", title: "SSO setup help", provider: "FACEBOOK", timeLabel: "Jan 22" },
    ],
  },
  {
    id: "sc-9",
    contactName: "Nirmala KC",
    provider: "INSTAGRAM",
    snippet: "Yo kurtha ko arko color cha? 💛",
    timeLabel: "12:02",
    unread: 2,
    status: "OPEN",
    waiting: true,
    assigneeName: null,
    tags: ["Sales", "Fashion"],
    phone: "+977 98601 33455",
    email: "nirmala.kc@example.com",
    location: "Bhaktapur, NP",
    customerSince: "May 2026",
    lastSeen: "active now",
    messages: thread("sc-9", [
      ["INBOUND", "Hi! I saw this kurtha on your story.", "11:57"],
      ["INBOUND", "Yo kurtha ko arko color cha? 💛", "12:02"],
      ["INBOUND", "Maroon ma cha bhane ma order garchu.", "12:02"],
    ]),
    previousInteractions: [],
  },
  {
    id: "sc-10",
    contactName: "Brooklyn Simmons",
    provider: "WHATSAPP",
    snippet: "That would be useful. How about team seats?",
    timeLabel: "Thu",
    unread: 0,
    status: "RESOLVED",
    waiting: false,
    assigneeName: "Rohan Karki",
    tags: ["Pricing"],
    phone: "+1 718 555 0119",
    email: "brooklyn.simmons@example.com",
    location: "Brooklyn, US",
    customerSince: "Sep 2025",
    lastSeen: "last seen Thursday",
    messages: thread("sc-10", [
      ["INBOUND", "That would be useful. How about team seats?", "Thu 13:21"],
      ["OUTBOUND", "Seats are per agent, and viewers are free on every plan.", "Thu 13:40", "READ"],
      ["INBOUND", "Great, we'll upgrade next month.", "Thu 13:42"],
    ]),
    previousInteractions: [],
  },
  {
    id: "sc-11",
    contactName: "Deepak Yadav",
    provider: "FACEBOOK",
    snippet: "Sir, mero refund ajhai aayena, 5 din bhaisakyo.",
    timeLabel: "13:45",
    unread: 1,
    status: "OPEN",
    waiting: true,
    assigneeName: "Priya Singh",
    tags: ["Refund", "Urgent"],
    phone: "+977 98230 77124",
    email: "deepak.yadav@example.com",
    location: "Biratnagar, NP",
    customerSince: "Dec 2025",
    lastSeen: "active now",
    messages: thread("sc-11", [
      ["INBOUND", "Sir, mero refund ajhai aayena, 5 din bhaisakyo.", "13:45"],
      ["INBOUND", "Transaction ID: KH-55213 (Khalti bata gareko).", "13:46"],
    ]),
    previousInteractions: [
      {
        id: "sc-11-p1",
        title: "Order #NP-7712 delivery",
        provider: "FACEBOOK",
        timeLabel: "Feb 11",
      },
    ],
  },
  {
    id: "sc-12",
    contactName: "Marvin McKinney",
    provider: "TELEGRAM",
    snippet: "What about data access for our compliance team?",
    timeLabel: "Sat",
    unread: 0,
    status: "PENDING",
    waiting: false,
    assigneeName: "Bibek Tamang",
    tags: ["Compliance"],
    phone: "+49 171 555 2034",
    email: "marvin.mckinney@example.eu",
    location: "Berlin, DE",
    customerSince: "Jul 2025",
    lastSeen: "last seen Saturday",
    messages: thread("sc-12", [
      ["INBOUND", "What about data access for our compliance team?", "Sat 08:19"],
      [
        "OUTBOUND",
        "Every conversation is exportable and audit-logged per workspace.",
        "Sat 08:44",
        "READ",
      ],
      ["INBOUND", "Good. Please share the DPA document when you can.", "Sat 08:47"],
    ]),
    previousInteractions: [],
  },
];

export const SAMPLE_UNREAD_TOTAL = SAMPLE_CONVERSATIONS.reduce(
  (sum, conversation) => sum + conversation.unread,
  0,
);
