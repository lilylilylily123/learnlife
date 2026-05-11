import type PocketBase from "pocketbase";
import type { Learner } from "../types";

export interface ListLearnersParams {
  page?: number;
  perPage?: number;
  search?: string;
  program?: string;
}

export interface ListLearnersResult {
  items: Learner[];
  totalItems: number;
  totalPages: number;
  page: number;
}

export async function listLearners(
  pb: PocketBase,
  params: ListLearnersParams = {},
): Promise<ListLearnersResult> {
  const { page = 1, perPage = 50, search, program } = params;

  const filterParts: string[] = [];
  if (search) {
    filterParts.push(
      pb.filter("(name ~ {:search} || email ~ {:search})", { search }),
    );
  }
  if (program) {
    filterParts.push(pb.filter("program = {:program}", { program }));
  }

  const response = await pb.collection("learners").getList(page, perPage, {
    filter: filterParts.length > 0 ? filterParts.join(" && ") : undefined,
    sort: "name",
  });

  return {
    items: response.items as unknown as Learner[],
    totalItems: response.totalItems,
    totalPages: response.totalPages,
    page: response.page,
  };
}

export async function getLearnerByNfc(
  pb: PocketBase,
  nfcId: string,
): Promise<Learner | null> {
  try {
    const record = await pb
      .collection("learners")
      .getFirstListItem(pb.filter("NFC_ID = {:nfcId}", { nfcId }));
    return record as unknown as Learner;
  } catch {
    return null;
  }
}

export async function getLearnerById(
  pb: PocketBase,
  id: string,
): Promise<Learner | null> {
  try {
    const record = await pb.collection("learners").getOne(id);
    return record as unknown as Learner;
  } catch {
    return null;
  }
}

export async function createLearner(
  pb: PocketBase,
  data: { name: string; email: string; program: string; dob: string; NFC_ID?: string },
): Promise<Learner> {
  const record = await pb.collection("learners").create(data);
  return record as unknown as Learner;
}

export async function updateLearnerComment(
  pb: PocketBase,
  learnerId: string,
  comment: string,
): Promise<Learner> {
  const updated = await pb.collection("learners").update(learnerId, { comments: comment });
  return updated as unknown as Learner;
}
