export interface HelpTopic {
   id: string;
   title: string;
   body: string;
}

const TOPICS: Array<HelpTopic> = [
   { id: "getting-started", title: "Getting started", body: "Welcome!" },
   { id: "billing", title: "Billing", body: "Invoices and payments." },
];

export function fetchTopics(q: string): Array<HelpTopic> {
   return TOPICS.filter((topic) => topic.title.toLowerCase().includes(q.toLowerCase()));
}

export function fetchTopic(topicId: string): HelpTopic {
   const topic = TOPICS.find((candidate) => candidate.id === topicId);
   if (!topic) throw new Error(`unknown topic ${topicId}`);
   return topic;
}
