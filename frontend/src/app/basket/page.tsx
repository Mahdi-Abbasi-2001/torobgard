import { redirect } from "next/navigation";

// The basket is part of every trip now (the strip on each mission screen); the old standalone page just goes home.
export default function Page() { redirect("/"); }
