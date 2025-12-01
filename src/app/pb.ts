"use client";
import PocketBase from "pocketbase";

const url = "https://learnlife.pockethost.io/";
export const pb = new PocketBase(url);
pb.autoCancellation(false);
