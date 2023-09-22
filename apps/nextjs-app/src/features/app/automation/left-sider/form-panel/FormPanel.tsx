import {
  Form,
  // FormControl,
  // FormDescription,
  // FormField,
  // FormItem,
  // FormLabel,
  // FormMessage,
  Button,
  Input,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teable-group/ui-lib';
// import classNames from 'classnames';
import { useForm } from 'react-hook-form';
import { Collapse } from '../../components';
import { Combobox, CollapsibleText } from './components';

const FormPanel = () => {
  const form = useForm();

  return (
    <div className="overflow-auto">
      <Form {...form}>
        <section className="p-3 flex flex-col">
          <span className="text-xs">ACTION DETAILS</span>
          <span className="text-xs pt-3">Action type</span>
          <Combobox></Combobox>
        </section>
        <section>
          <Accordion type="multiple" className="w-full border-t">
            <AccordionItem value="item-1">
              <AccordionTrigger className="px-3 hover:no-underline">LABELS</AccordionTrigger>
              <AccordionContent className="px-3">
                <div className="py-2">Description</div>
                <Input placeholder="Enter a description"></Input>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-2">
              <AccordionTrigger className="px-3 hover:no-underline">CONFIGURATION</AccordionTrigger>
              <AccordionContent>
                Yes. It comes with default styles that matches the other components&apos; aesthetic.
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-3">
              <AccordionTrigger className="px-3 hover:no-underline">TEST STEP</AccordionTrigger>
              <AccordionContent>
                <Tabs defaultValue="generatePreview" className="flex flex-col justify-center">
                  <TabsList className="grid grid-cols-2 m-2">
                    <TabsTrigger value="generatePreview">Generate a preview</TabsTrigger>
                    <TabsTrigger value="runConfigured">Run as configured</TabsTrigger>
                  </TabsList>
                  <div className="px-2">
                    <TabsContent value="generatePreview">
                      <Button variant="outline" className="w-full">
                        Generate a preview
                      </Button>
                    </TabsContent>
                    <TabsContent value="runConfigured">
                      <Button variant="outline" className="w-full">
                        Run as configured
                      </Button>
                    </TabsContent>
                  </div>
                </Tabs>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="item-4">
              <AccordionTrigger className="px-3 hover:no-underline">RESULTS</AccordionTrigger>
              <AccordionContent className="px-2">
                <Button variant="outline" className="w-full">
                  View result
                </Button>
                <div className="py-2 text-green-700">Step successful</div>
                <div>Step run a few seconds ago</div>
                <Collapse className="border rounded-md">
                  <div className="w-full">
                    <CollapsibleText className="hover:bg-secondary p-2 cursor-pointer w-full">
                      <span>
                        <span className="pr-2 font-medium">to:</span>
                        123123123213123123123213123123123213123123123213123123123213123123123213123123123213123123123213
                      </span>
                    </CollapsibleText>
                    <CollapsibleText className="hover:bg-secondary p-2 cursor-pointer w-full">
                      <span>
                        <span className="pr-2 font-medium">to:</span>
                        123
                      </span>
                    </CollapsibleText>
                  </div>
                </Collapse>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
        {/* <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="shadcn" {...field} />
              </FormControl>
              <FormDescription>This is your public display name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        /> */}
      </Form>
    </div>
  );
};

export { FormPanel };
