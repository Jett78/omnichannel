import type { Provider } from "@/generated/prisma/client";

/**
 * SAMPLE DATA — UI preview only. Fictional contacts, kept out of the
 * database; real contacts are created automatically when messages
 * arrive on a connected channel.
 */
export interface SampleContact {
  id: string;
  name: string;
  providers: Provider[];
  email: string;
  phone: string;
  location: string;
  tags: string[];
  lastActiveLabel: string;
  /** Minutes since last activity — used for sorting. */
  lastActiveMinutes: number;
  conversationsCount: number;
}

export const SAMPLE_CONTACTS: SampleContact[] = [
  {
    id: "ct-1",
    name: "Michelle Carlson",
    providers: ["WHATSAPP", "FACEBOOK"],
    email: "michelle.carlson@example.com",
    phone: "+1 415 555 0132",
    location: "San Francisco, US",
    tags: ["Sales", "Priority"],
    lastActiveLabel: "4 min ago",
    lastActiveMinutes: 4,
    conversationsCount: 3,
  },
  {
    id: "ct-2",
    name: "Sagar Thapa",
    providers: ["WHATSAPP"],
    email: "sagar.thapa@example.com",
    phone: "+977 98510 22341",
    location: "Pokhara, NP",
    tags: ["Delivery"],
    lastActiveLabel: "18 min ago",
    lastActiveMinutes: 18,
    conversationsCount: 2,
  },
  {
    id: "ct-3",
    name: "Anjali Gurung",
    providers: ["TELEGRAM", "WHATSAPP"],
    email: "anjali.gurung@example.com",
    phone: "+977 98130 44782",
    location: "Kathmandu, NP",
    tags: ["Booking"],
    lastActiveLabel: "32 min ago",
    lastActiveMinutes: 32,
    conversationsCount: 3,
  },
  {
    id: "ct-4",
    name: "Nirmala KC",
    providers: ["INSTAGRAM"],
    email: "nirmala.kc@example.com",
    phone: "+977 98601 33455",
    location: "Bhaktapur, NP",
    tags: ["Fashion"],
    lastActiveLabel: "1 hr ago",
    lastActiveMinutes: 60,
    conversationsCount: 1,
  },
  {
    id: "ct-5",
    name: "Prakash Shrestha",
    providers: ["FACEBOOK"],
    email: "prakash.shrestha@example.com",
    phone: "+977 98412 90876",
    location: "Lalitpur, NP",
    tags: ["Stock"],
    lastActiveLabel: "2 hrs ago",
    lastActiveMinutes: 120,
    conversationsCount: 1,
  },
  {
    id: "ct-6",
    name: "Deepak Yadav",
    providers: ["FACEBOOK", "WHATSAPP"],
    email: "deepak.yadav@example.com",
    phone: "+977 98230 77124",
    location: "Biratnagar, NP",
    tags: ["Refund"],
    lastActiveLabel: "3 hrs ago",
    lastActiveMinutes: 180,
    conversationsCount: 2,
  },
  {
    id: "ct-7",
    name: "Robert Fox",
    providers: ["WHATSAPP"],
    email: "robert.fox@example.co.uk",
    phone: "+44 7700 900123",
    location: "London, UK",
    tags: ["Sales"],
    lastActiveLabel: "Yesterday",
    lastActiveMinutes: 1500,
    conversationsCount: 1,
  },
  {
    id: "ct-8",
    name: "Theresa Webb",
    providers: ["TELEGRAM", "FACEBOOK"],
    email: "theresa.webb@example.com",
    phone: "+1 312 555 0143",
    location: "Chicago, US",
    tags: ["Support"],
    lastActiveLabel: "Yesterday",
    lastActiveMinutes: 1560,
    conversationsCount: 2,
  },
  {
    id: "ct-9",
    name: "Guy Hawkins",
    providers: ["WHATSAPP"],
    email: "guy.hawkins@example.com.au",
    phone: "+61 412 555 908",
    location: "Sydney, AU",
    tags: ["Onboarding"],
    lastActiveLabel: "2 days ago",
    lastActiveMinutes: 2900,
    conversationsCount: 1,
  },
  {
    id: "ct-10",
    name: "Dianne Russell",
    providers: ["TELEGRAM"],
    email: "dianne.russell@example.com",
    phone: "+1 646 555 0187",
    location: "New York, US",
    tags: ["Reporting"],
    lastActiveLabel: "2 days ago",
    lastActiveMinutes: 3000,
    conversationsCount: 2,
  },
];
