import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth";

export async function POST() {
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.delete(COOKIE);
  return res;
}
