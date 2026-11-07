import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DatasetBuilder } from "./dataset-builder"
import { TrainingRunner } from "./training-runner"

export function TrainingPage() {
  return (
    <Tabs defaultValue="prepare">
      <TabsList className="mb-6">
        <TabsTrigger value="prepare">1 · Preparar dataset</TabsTrigger>
        <TabsTrigger value="train">2 · Entrenar modelo</TabsTrigger>
      </TabsList>
      <TabsContent value="prepare">
        <DatasetBuilder />
      </TabsContent>
      <TabsContent value="train">
        <TrainingRunner />
      </TabsContent>
    </Tabs>
  )
}
